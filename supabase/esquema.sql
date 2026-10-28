-- =====================================================================
--  FIRMA ELECTRÓNICA · POLICÍA DE SALTA
--  Esquema de base de datos para Supabase
--
--  Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
--  Ejecutarlo UNA sola vez en un proyecto nuevo.
--
--  Principios:
--   * Cada agente tiene UNA cuenta (legajo + contraseña) y UNA firma.
--   * Nadie entrega su contraseña ni su firma: el agente redacta el acta y
--     le ENVÍA una solicitud al superior; el superior la lee y la firma él
--     mismo con su PIN de firma. Cada firma vale solo para esa acta.
--   * Al enviar a firma, el texto del acta queda bloqueado y se le calcula
--     una huella SHA-256. La firma queda atada a esa huella.
--   * Todo queda registrado: el superior ve quién le pidió la firma y en
--     qué acta; cualquiera puede verificar un acta impresa con su código.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
--  TABLAS
-- ---------------------------------------------------------------------

-- Perfil de cada agente (se crea solo al registrarse)
create table public.perfiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  legajo       text not null unique check (legajo ~ '^[0-9A-Z]{3,15}$'),
  apellido     text not null check (length(apellido) between 2 and 60),
  nombre       text not null check (length(nombre) between 2 and 60),
  jerarquia    text not null check (length(jerarquia) between 3 and 60),
  dependencia  text not null check (length(dependencia) between 3 and 120),
  cargo        text check (cargo is null or length(cargo) <= 120),
  rol          text not null default 'agente' check (rol in ('agente','admin')),
  estado       text not null default 'pendiente' check (estado in ('pendiente','activo','suspendido')),
  creado_at    timestamptz not null default now()
);

-- Firma de cada agente (imagen + PIN). Nadie la lee directamente:
-- solo se usa a través de las funciones de abajo.
create table public.firmas (
  usuario_id        uuid primary key references public.perfiles(id) on delete cascade,
  imagen            text not null check (imagen like 'data:image/png;base64,%' and length(imagen) < 400000),
  pin_hash          text not null,
  intentos_fallidos int  not null default 0,
  bloqueada_hasta   timestamptz,
  actualizada_at    timestamptz not null default now()
);

-- Actas / documentos
create table public.actas (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  autor_id         uuid not null references public.perfiles(id),
  autor_nombre     text,
  autor_jerarquia  text,
  autor_legajo     text,
  dependencia      text,
  tipo             text not null check (length(tipo) between 3 and 80),
  titulo           text not null check (length(titulo) between 3 and 200),
  lugar            text check (lugar is null or length(lugar) <= 200),
  contenido        text not null check (length(contenido) between 10 and 60000),
  hash             text,
  estado           text not null default 'borrador'
                     check (estado in ('borrador','en_firma','firmada','rechazada','anulada')),
  motivo_anulacion text,
  creada_at        timestamptz not null default now(),
  actualizada_at   timestamptz not null default now(),
  enviada_at       timestamptz
);
create index actas_autor_idx on public.actas(autor_id, creada_at desc);

-- Solicitudes de firma: una por acta y por firmante
create table public.solicitudes_firma (
  id                    uuid primary key default gen_random_uuid(),
  acta_id               uuid not null references public.actas(id) on delete cascade,
  solicitante_id        uuid not null references public.perfiles(id),
  firmante_id           uuid not null references public.perfiles(id),
  orden                 int  not null default 1,
  mensaje               text check (mensaje is null or length(mensaje) <= 500),
  estado                text not null default 'pendiente'
                          check (estado in ('pendiente','firmada','rechazada','cancelada')),
  motivo_rechazo        text,
  hash_firmado          text,
  firma_imagen          text,   -- copia de la firma al momento de firmar
  firmante_nombre       text,   -- datos del firmante al momento de firmar
  firmante_jerarquia    text,
  firmante_cargo        text,
  firmante_dependencia  text,
  firmante_legajo       text,
  creada_at             timestamptz not null default now(),
  resuelta_at           timestamptz,
  unique (acta_id, firmante_id)
);
create index solicitudes_firmante_idx on public.solicitudes_firma(firmante_id, estado, creada_at desc);
create index solicitudes_acta_idx on public.solicitudes_firma(acta_id);

-- Registro de auditoría (no se puede borrar ni editar desde la app)
create table public.auditoria (
  id          bigint generated always as identity primary key,
  usuario_id  uuid references public.perfiles(id) on delete set null,
  accion      text not null,
  acta_id     uuid references public.actas(id) on delete set null,
  detalle     jsonb,
  fecha       timestamptz not null default now()
);
create index auditoria_usuario_idx on public.auditoria(usuario_id, fecha desc);

-- ---------------------------------------------------------------------
--  FUNCIONES AUXILIARES
-- ---------------------------------------------------------------------

create or replace function public.es_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and estado = 'activo');
$$;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and estado = 'activo' and rol = 'admin');
$$;

create or replace function public.participa_en_acta(p_acta uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from actas where id = p_acta and autor_id = auth.uid())
      or exists (select 1 from solicitudes_firma where acta_id = p_acta and firmante_id = auth.uid());
$$;

create or replace function public.calcular_hash_acta(
  p_codigo text, p_autor uuid, p_tipo text, p_titulo text, p_lugar text, p_contenido text
) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(convert_to(
    p_codigo || E'\n' || p_autor::text || E'\n' || p_tipo || E'\n' || p_titulo || E'\n' ||
    coalesce(p_lugar, '') || E'\n' || p_contenido, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function public.registrar(p_accion text, p_acta uuid, p_detalle jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into auditoria(usuario_id, accion, acta_id, detalle) values (auth.uid(), p_accion, p_acta, p_detalle);
$$;

-- ---------------------------------------------------------------------
--  TRIGGERS
-- ---------------------------------------------------------------------

-- Al registrarse en Auth se crea el perfil (siempre como agente pendiente)
create or replace function public.tg_nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into perfiles(id, legajo, apellido, nombre, jerarquia, dependencia, cargo)
  values (
    new.id,
    upper(trim(m->>'legajo')),
    upper(trim(m->>'apellido')),
    initcap(trim(m->>'nombre')),
    trim(m->>'jerarquia'),
    trim(m->>'dependencia'),
    nullif(trim(m->>'cargo'), '')
  );
  return new;
end $$;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.tg_nuevo_usuario();

-- Protege el contenido del acta y recalcula la huella
create or replace function public.tg_actas() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare p perfiles;
begin
  if tg_op = 'INSERT' then
    select * into p from perfiles where id = auth.uid();
    if not found then raise exception 'Usuario no válido.'; end if;
    new.autor_id        := p.id;
    new.autor_nombre    := p.apellido || ', ' || p.nombre;
    new.autor_jerarquia := p.jerarquia;
    new.autor_legajo    := p.legajo;
    new.dependencia     := p.dependencia;
    new.estado          := 'borrador';
  else
    if old.estado <> 'borrador' and
       (new.tipo, new.titulo, new.lugar, new.contenido) is distinct from
       (old.tipo, old.titulo, old.lugar, old.contenido) then
      raise exception 'El acta ya fue enviada a firma: su texto no se puede modificar.';
    end if;
    if new.codigo <> old.codigo or new.autor_id <> old.autor_id then
      raise exception 'Datos del acta no modificables.';
    end if;
    new.actualizada_at := now();
  end if;
  new.hash := calcular_hash_acta(new.codigo, new.autor_id, new.tipo, new.titulo, new.lugar, new.contenido);
  return new;
end $$;

create trigger actas_proteger
  before insert or update on public.actas
  for each row execute function public.tg_actas();

-- ---------------------------------------------------------------------
--  FUNCIONES DE LA APLICACIÓN (RPC)
-- ---------------------------------------------------------------------

-- Mi firma: ¿la tengo registrada? (devuelve la imagen solo al dueño)
create or replace function public.mi_firma()
returns table (tiene boolean, imagen text, actualizada_at timestamptz, bloqueada_hasta timestamptz)
language sql stable security definer set search_path = public as $$
  select true, f.imagen, f.actualizada_at, f.bloqueada_hasta from firmas f where f.usuario_id = auth.uid()
  union all
  select false, null, null, null where not exists (select 1 from firmas where usuario_id = auth.uid());
$$;

-- Registrar o cambiar mi firma. Para cambiarla hay que dar el PIN actual.
create or replace function public.guardar_firma(p_imagen text, p_pin_nuevo text, p_pin_actual text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare f firmas;
begin
  if not es_activo() then return jsonb_build_object('ok', false, 'error', 'Tu cuenta no está activa.'); end if;
  if p_imagen is null or p_imagen not like 'data:image/png;base64,%' or length(p_imagen) >= 400000 then
    return jsonb_build_object('ok', false, 'error', 'La imagen de la firma no es válida.');
  end if;
  if p_pin_nuevo is null or p_pin_nuevo !~ '^[0-9]{6}$' then
    return jsonb_build_object('ok', false, 'error', 'El PIN de firma debe tener exactamente 6 números.');
  end if;

  select * into f from firmas where usuario_id = auth.uid() for update;
  if found then
    if f.bloqueada_hasta is not null and f.bloqueada_hasta > now() then
      return jsonb_build_object('ok', false, 'error',
        'Firma bloqueada por intentos fallidos hasta las ' || to_char(f.bloqueada_hasta at time zone 'America/Argentina/Salta', 'HH24:MI') || '.');
    end if;
    if p_pin_actual is null or f.pin_hash <> crypt(p_pin_actual, f.pin_hash) then
      update firmas set
        intentos_fallidos = case when f.intentos_fallidos + 1 >= 5 then 0 else f.intentos_fallidos + 1 end,
        bloqueada_hasta   = case when f.intentos_fallidos + 1 >= 5 then now() + interval '15 minutes' else null end
      where usuario_id = auth.uid();
      perform registrar('pin_incorrecto', null, jsonb_build_object('en', 'cambio_firma'));
      return jsonb_build_object('ok', false, 'error', 'El PIN actual no es correcto.');
    end if;
    update firmas set imagen = p_imagen, pin_hash = crypt(p_pin_nuevo, gen_salt('bf')),
      intentos_fallidos = 0, bloqueada_hasta = null, actualizada_at = now()
    where usuario_id = auth.uid();
    perform registrar('firma_actualizada', null);
  else
    insert into firmas(usuario_id, imagen, pin_hash) values (auth.uid(), p_imagen, crypt(p_pin_nuevo, gen_salt('bf')));
    perform registrar('firma_registrada', null);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Buscar personal activo para pedirle la firma
create or replace function public.buscar_personal(p_texto text)
returns table (id uuid, legajo text, apellido text, nombre text, jerarquia text,
               dependencia text, cargo text, tiene_firma boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.legajo, p.apellido, p.nombre, p.jerarquia, p.dependencia, p.cargo,
         exists (select 1 from firmas f where f.usuario_id = p.id)
  from perfiles p
  where es_activo()
    and p.estado = 'activo'
    and length(trim(coalesce(p_texto, ''))) >= 2
    and (p.apellido ilike '%' || trim(p_texto) || '%'
      or p.nombre ilike '%' || trim(p_texto) || '%'
      or p.legajo ilike trim(p_texto) || '%'
      or p.dependencia ilike '%' || trim(p_texto) || '%'
      or p.jerarquia ilike '%' || trim(p_texto) || '%')
  order by p.apellido, p.nombre
  limit 30;
$$;

-- Enviar el acta a firma (o sumar firmantes si ya está en firma)
create or replace function public.enviar_a_firma(p_acta uuid, p_firmantes uuid[], p_mensaje text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a actas; fid uuid; n int := 0; orden_base int;
begin
  if not es_activo() then raise exception 'Tu cuenta no está activa.'; end if;
  select * into a from actas where id = p_acta for update;
  if not found or a.autor_id <> auth.uid() then raise exception 'Acta no encontrada.'; end if;
  if a.estado not in ('borrador', 'en_firma') then raise exception 'Esta acta ya no admite firmas.'; end if;
  if p_firmantes is null or cardinality(p_firmantes) = 0 then raise exception 'Elegí al menos un firmante.'; end if;
  if cardinality(p_firmantes) > 10 then raise exception 'Máximo 10 firmantes por acta.'; end if;

  select coalesce(max(orden), 0) into orden_base from solicitudes_firma where acta_id = p_acta;

  foreach fid in array p_firmantes loop
    if not exists (select 1 from perfiles where id = fid and estado = 'activo') then
      raise exception 'Uno de los firmantes elegidos no tiene una cuenta activa.';
    end if;
    insert into solicitudes_firma(acta_id, solicitante_id, firmante_id, orden, mensaje)
    values (p_acta, auth.uid(), fid, orden_base + n + 1, nullif(trim(coalesce(p_mensaje, '')), ''))
    on conflict (acta_id, firmante_id) do nothing;
    if found then n := n + 1; end if;
  end loop;

  if n = 0 then raise exception 'Esas personas ya tenían la solicitud de firma.'; end if;

  update actas set estado = 'en_firma', enviada_at = coalesce(enviada_at, now()) where id = p_acta;
  perform registrar('acta_enviada_a_firma', p_acta, jsonb_build_object('firmantes', to_jsonb(p_firmantes)));
  return jsonb_build_object('ok', true, 'solicitudes', n);
end $$;

-- Firmar: lo hace el propio firmante con su PIN
create or replace function public.firmar_solicitud(p_solicitud uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare p perfiles; s solicitudes_firma; a actas; f firmas; pendientes int;
begin
  select * into p from perfiles where id = auth.uid();
  if not found or p.estado <> 'activo' then
    return jsonb_build_object('ok', false, 'error', 'Tu cuenta no está activa.');
  end if;

  select * into s from solicitudes_firma where id = p_solicitud for update;
  if not found or s.firmante_id <> p.id then
    return jsonb_build_object('ok', false, 'error', 'Solicitud no encontrada.');
  end if;
  if s.estado <> 'pendiente' then
    return jsonb_build_object('ok', false, 'error', 'Esta solicitud ya fue resuelta.');
  end if;

  select * into a from actas where id = s.acta_id for update;
  if a.estado <> 'en_firma' then
    return jsonb_build_object('ok', false, 'error', 'El acta ya no está esperando firmas.');
  end if;

  select * into f from firmas where usuario_id = p.id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Primero tenés que registrar tu firma en "Mi firma".');
  end if;
  if f.bloqueada_hasta is not null and f.bloqueada_hasta > now() then
    return jsonb_build_object('ok', false, 'error',
      'Firma bloqueada por intentos fallidos hasta las ' || to_char(f.bloqueada_hasta at time zone 'America/Argentina/Salta', 'HH24:MI') || '.');
  end if;
  if p_pin is null or f.pin_hash <> crypt(p_pin, f.pin_hash) then
    update firmas set
      intentos_fallidos = case when f.intentos_fallidos + 1 >= 5 then 0 else f.intentos_fallidos + 1 end,
      bloqueada_hasta   = case when f.intentos_fallidos + 1 >= 5 then now() + interval '15 minutes' else null end
    where usuario_id = p.id;
    perform registrar('pin_incorrecto', a.id, jsonb_build_object('en', 'firma'));
    return jsonb_build_object('ok', false, 'error',
      case when f.intentos_fallidos + 1 >= 5 then 'PIN incorrecto. Tu firma quedó bloqueada 15 minutos.'
           when f.intentos_fallidos + 1 = 4 then 'PIN incorrecto. Te queda 1 intento.'
           else 'PIN incorrecto. Te quedan ' || (5 - f.intentos_fallidos - 1) || ' intentos.' end);
  end if;

  update firmas set intentos_fallidos = 0, bloqueada_hasta = null where usuario_id = p.id;

  update solicitudes_firma set
    estado = 'firmada', resuelta_at = now(), hash_firmado = a.hash, firma_imagen = f.imagen,
    firmante_nombre = p.apellido || ', ' || p.nombre, firmante_jerarquia = p.jerarquia,
    firmante_cargo = p.cargo, firmante_dependencia = p.dependencia, firmante_legajo = p.legajo
  where id = s.id;

  select count(*) into pendientes from solicitudes_firma where acta_id = a.id and estado = 'pendiente';
  if pendientes = 0 then update actas set estado = 'firmada' where id = a.id; end if;

  perform registrar('acta_firmada', a.id, jsonb_build_object('solicitud', s.id, 'hash', a.hash));
  return jsonb_build_object('ok', true, 'acta_completa', pendientes = 0);
end $$;

-- Rechazar: el firmante no presta su firma (con motivo)
create or replace function public.rechazar_solicitud(p_solicitud uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s solicitudes_firma;
begin
  if not es_activo() then return jsonb_build_object('ok', false, 'error', 'Tu cuenta no está activa.'); end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    return jsonb_build_object('ok', false, 'error', 'Escribí el motivo del rechazo (mínimo 5 letras).');
  end if;
  select * into s from solicitudes_firma where id = p_solicitud for update;
  if not found or s.firmante_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'Solicitud no encontrada.');
  end if;
  if s.estado <> 'pendiente' then
    return jsonb_build_object('ok', false, 'error', 'Esta solicitud ya fue resuelta.');
  end if;

  update solicitudes_firma set estado = 'rechazada', motivo_rechazo = trim(p_motivo), resuelta_at = now() where id = s.id;
  update solicitudes_firma set estado = 'cancelada', resuelta_at = now() where acta_id = s.acta_id and estado = 'pendiente';
  update actas set estado = 'rechazada' where id = s.acta_id;
  perform registrar('firma_rechazada', s.acta_id, jsonb_build_object('motivo', trim(p_motivo)));
  return jsonb_build_object('ok', true);
end $$;

-- Anular un acta (solo el autor)
create or replace function public.anular_acta(p_acta uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a actas;
begin
  if not es_activo() then return jsonb_build_object('ok', false, 'error', 'Tu cuenta no está activa.'); end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then
    return jsonb_build_object('ok', false, 'error', 'Escribí el motivo de la anulación.');
  end if;
  select * into a from actas where id = p_acta for update;
  if not found or a.autor_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'Acta no encontrada.');
  end if;
  if a.estado = 'anulada' then return jsonb_build_object('ok', false, 'error', 'El acta ya está anulada.'); end if;

  update solicitudes_firma set estado = 'cancelada', resuelta_at = now() where acta_id = p_acta and estado = 'pendiente';
  update actas set estado = 'anulada', motivo_anulacion = trim(p_motivo) where id = p_acta;
  perform registrar('acta_anulada', p_acta, jsonb_build_object('motivo', trim(p_motivo)));
  return jsonb_build_object('ok', true);
end $$;

-- Verificación pública por código (no muestra el texto del acta)
create or replace function public.verificar_acta(p_codigo text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when a.id is null then jsonb_build_object('encontrada', false)
  else jsonb_build_object(
    'encontrada', true,
    'codigo', a.codigo, 'tipo', a.tipo, 'titulo', a.titulo, 'lugar', a.lugar,
    'dependencia', a.dependencia, 'estado', a.estado, 'hash', a.hash,
    'creada_at', a.creada_at, 'motivo_anulacion', a.motivo_anulacion,
    'autor', a.autor_jerarquia || ' ' || a.autor_nombre,
    'firmas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'firmante', coalesce(s.firmante_jerarquia || ' ' || s.firmante_nombre, p.jerarquia || ' ' || p.apellido || ', ' || p.nombre),
        'cargo', coalesce(s.firmante_cargo, p.cargo),
        'estado', s.estado,
        'fecha', s.resuelta_at,
        'huella_coincide', s.hash_firmado is not null and s.hash_firmado = a.hash
      ) order by s.orden)
      from solicitudes_firma s join perfiles p on p.id = s.firmante_id
      where s.acta_id = a.id and s.estado in ('firmada','pendiente','rechazada')
    ), '[]'::jsonb))
  end
  from (select 1) x left join actas a on a.codigo = upper(trim(p_codigo));
$$;

-- ---------- Administración ----------

create or replace function public.admin_usuarios(p_estado text default null, p_texto text default null)
returns table (id uuid, legajo text, apellido text, nombre text, jerarquia text, dependencia text,
               cargo text, rol text, estado text, creado_at timestamptz, tiene_firma boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo administradores.'; end if;
  return query
    select p.id, p.legajo, p.apellido, p.nombre, p.jerarquia, p.dependencia, p.cargo, p.rol, p.estado,
           p.creado_at, exists (select 1 from firmas f where f.usuario_id = p.id)
    from perfiles p
    where (p_estado is null or p.estado = p_estado)
      and (p_texto is null or trim(p_texto) = ''
           or p.apellido ilike '%' || trim(p_texto) || '%' or p.legajo ilike trim(p_texto) || '%'
           or p.dependencia ilike '%' || trim(p_texto) || '%')
    order by (p.estado = 'pendiente') desc, p.apellido, p.nombre
    limit 200;
end $$;

create or replace function public.admin_actualizar_usuario(
  p_id uuid, p_estado text, p_rol text, p_jerarquia text, p_dependencia text, p_cargo text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo administradores.'; end if;
  if p_id = auth.uid() and (p_rol <> 'admin' or p_estado <> 'activo') then
    raise exception 'No podés quitarte a vos mismo el rol de administrador ni suspender tu cuenta.';
  end if;
  update perfiles set estado = p_estado, rol = p_rol, jerarquia = trim(p_jerarquia),
                      dependencia = trim(p_dependencia), cargo = nullif(trim(coalesce(p_cargo, '')), '')
  where id = p_id;
  if not found then raise exception 'Usuario no encontrado.'; end if;
  perform registrar('admin_usuario_actualizado', null,
    jsonb_build_object('usuario', p_id, 'estado', p_estado, 'rol', p_rol));
  return jsonb_build_object('ok', true);
end $$;

-- Borra la firma de un agente (por ejemplo si olvidó el PIN) para que la registre de nuevo
create or replace function public.admin_resetear_firma(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo administradores.'; end if;
  delete from firmas where usuario_id = p_id;
  perform registrar('admin_firma_reseteada', null, jsonb_build_object('usuario', p_id));
  return jsonb_build_object('ok', true);
end $$;

-- Restablece la contraseña de un agente que la olvidó. El administrador
-- le entrega la contraseña provisoria en persona y el agente la cambia.
create or replace function public.admin_restablecer_clave(p_id uuid, p_clave text)
returns jsonb language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not es_admin() then raise exception 'Solo administradores.'; end if;
  if p_clave is null or length(p_clave) < 8 then raise exception 'La contraseña provisoria debe tener al menos 8 caracteres.'; end if;
  update auth.users set encrypted_password = crypt(p_clave, gen_salt('bf', 10)) where id = p_id;
  if not found then raise exception 'Usuario no encontrado.'; end if;
  perform registrar('admin_clave_restablecida', null, jsonb_build_object('usuario', p_id));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
--  SEGURIDAD: RLS + PERMISOS
-- ---------------------------------------------------------------------

alter table public.perfiles          enable row level security;
alter table public.firmas            enable row level security;
alter table public.actas             enable row level security;
alter table public.solicitudes_firma enable row level security;
alter table public.auditoria         enable row level security;

create policy perfiles_ver on public.perfiles for select to authenticated
  using (id = auth.uid() or (estado = 'activo' and public.es_activo()) or public.es_admin());

-- firmas: sin políticas = nadie accede directo (solo vía funciones)

create policy actas_ver on public.actas for select to authenticated
  using (autor_id = auth.uid() or public.participa_en_acta(id));
create policy actas_crear on public.actas for insert to authenticated
  with check (autor_id = auth.uid() and public.es_activo());
create policy actas_editar on public.actas for update to authenticated
  using (autor_id = auth.uid() and estado = 'borrador' and public.es_activo())
  with check (autor_id = auth.uid() and estado = 'borrador');
create policy actas_borrar on public.actas for delete to authenticated
  using (autor_id = auth.uid() and estado = 'borrador');

create policy solicitudes_ver on public.solicitudes_firma for select to authenticated
  using (solicitante_id = auth.uid() or firmante_id = auth.uid() or public.participa_en_acta(acta_id));

create policy auditoria_ver on public.auditoria for select to authenticated
  using (usuario_id = auth.uid() or public.es_admin());

-- Permisos de tablas: lo mínimo indispensable
revoke all on all tables in schema public from anon, authenticated;
grant select on public.perfiles, public.actas, public.solicitudes_firma, public.auditoria to authenticated;
grant insert (tipo, titulo, lugar, contenido) on public.actas to authenticated;
grant update (tipo, titulo, lugar, contenido) on public.actas to authenticated;
grant delete on public.actas to authenticated;

-- Permisos de funciones
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.mi_firma()                                   to authenticated;
grant execute on function public.guardar_firma(text, text, text)              to authenticated;
grant execute on function public.buscar_personal(text)                        to authenticated;
grant execute on function public.enviar_a_firma(uuid, uuid[], text)           to authenticated;
grant execute on function public.firmar_solicitud(uuid, text)                 to authenticated;
grant execute on function public.rechazar_solicitud(uuid, text)               to authenticated;
grant execute on function public.anular_acta(uuid, text)                      to authenticated;
grant execute on function public.verificar_acta(text)                         to anon, authenticated;
grant execute on function public.admin_usuarios(text, text)                   to authenticated;
grant execute on function public.admin_actualizar_usuario(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.admin_resetear_firma(uuid)                   to authenticated;
grant execute on function public.admin_restablecer_clave(uuid, text)          to authenticated;
-- usadas dentro de las políticas RLS
grant execute on function public.es_activo()            to authenticated;
grant execute on function public.es_admin()             to authenticated;
grant execute on function public.participa_en_acta(uuid) to authenticated;

-- =====================================================================
--  PRIMER ADMINISTRADOR
--  1) Registrate en la página con tu legajo.
--  2) Ejecutá esto cambiando 'TU_LEGAJO' por tu número de legajo:
--
--     update public.perfiles set rol = 'admin', estado = 'activo' where legajo = 'TU_LEGAJO';
--
--  Desde ahí activás a los demás desde la pestaña "Administración".
-- =====================================================================
