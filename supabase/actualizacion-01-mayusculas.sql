-- =====================================================================
--  ACTUALIZACIÓN 01 · Datos del personal en MAYÚSCULAS
--  Supabase → SQL Editor → New query → pegar todo → Run.
--  Se puede ejecutar más de una vez sin problema.
-- =====================================================================

-- 1) Las cuentas nuevas se guardan en mayúsculas
create or replace function public.tg_nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into perfiles(id, legajo, apellido, nombre, jerarquia, dependencia, cargo)
  values (
    new.id,
    upper(trim(m->>'legajo')),
    upper(trim(m->>'apellido')),
    upper(trim(m->>'nombre')),
    upper(trim(m->>'jerarquia')),
    upper(trim(m->>'dependencia')),
    nullif(upper(trim(m->>'cargo')), '')
  );
  return new;
end $$;

-- 2) Los cambios que hace el administrador también
create or replace function public.admin_actualizar_usuario(
  p_id uuid, p_estado text, p_rol text, p_jerarquia text, p_dependencia text, p_cargo text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo administradores.'; end if;
  if p_id = auth.uid() and (p_rol <> 'admin' or p_estado <> 'activo') then
    raise exception 'No podés quitarte a vos mismo el rol de administrador ni suspender tu cuenta.';
  end if;
  update perfiles set estado = p_estado, rol = p_rol, jerarquia = upper(trim(p_jerarquia)),
                      dependencia = upper(trim(p_dependencia)), cargo = nullif(upper(trim(coalesce(p_cargo, ''))), '')
  where id = p_id;
  if not found then raise exception 'Usuario no encontrado.'; end if;
  perform registrar('admin_usuario_actualizado', null,
    jsonb_build_object('usuario', p_id, 'estado', p_estado, 'rol', p_rol));
  return jsonb_build_object('ok', true);
end $$;

-- 3) Pasar a mayúsculas el personal que ya estaba registrado
update public.perfiles set
  apellido    = upper(apellido),
  nombre      = upper(nombre),
  jerarquia   = upper(jerarquia),
  dependencia = upper(dependencia),
  cargo       = upper(cargo);
