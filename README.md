# Firma Electrónica · Policía de Salta

Sistema web para que cada integrante de la Policía de la Provincia de Salta tenga **su propia firma electrónica**, protegida con usuario (legajo), contraseña y un **PIN de firma**, y para reducir el papeleo: las actas se redactan, se envían a firma, se firman y se verifican en línea.

## Cómo funciona

1. **Cada agente crea su cuenta** con su legajo y contraseña. La cuenta queda *pendiente* hasta que un administrador verifica los datos y la activa.
2. **Cada agente registra su firma una sola vez** (la dibuja con el dedo, lápiz o mouse) y elige un **PIN de 6 números**. Solo él puede cambiarla.
3. **El agente redacta el acta** y la **envía a firma** al jefe (o a varios). Puede sumar también su propia firma.
4. Al enviarla, **el texto queda bloqueado** y se calcula una huella digital (SHA‑256). Nadie puede cambiarlo después.
5. **El jefe ve la solicitud en "Por firmar"**, lee el acta y la **firma con su PIN** (o la rechaza con motivo). Nadie usa la contraseña ni la firma de otro: el jefe *autoriza* firmando él mismo, desde su cuenta, y **esa firma vale solo para esa acta**.
6. El acta firmada se **imprime o guarda en PDF** con **código de verificación, QR y huella**.
7. **Historial**: cada jefe ve en "Historial de mi firma" quién le pidió la firma, en qué acta, cuándo y qué respondió (y lo puede descargar en Excel).
8. **Verificación pública**: cualquiera puede escanear el QR o entrar a `verificar.html` con el código para comprobar que el acta es auténtica, quién la firmó y si fue anulada.

### Seguridad incluida
- Las reglas viven en la base de datos (Row Level Security): aunque alguien manipule la página, no puede ver actas ajenas, firmar por otro ni modificar un acta enviada.
- La imagen de la firma no se puede leer directamente: solo se copia al acta en el momento en que su dueño firma con el PIN.
- 5 PIN incorrectos bloquean la firma 15 minutos.
- La sesión se cierra al cerrar el navegador y tras 20 minutos sin uso (para computadoras compartidas).
- Registro de auditoría de cada acción (envíos, firmas, rechazos, PIN incorrectos, cambios de administrador).

## Puesta en marcha (una sola vez)

### 1. Crear la base de datos en Supabase (gratis)
1. Entrá a [supabase.com](https://supabase.com) → **New project** (región: São Paulo). Guardá la contraseña de la base.
2. Menú **SQL Editor** → **New query** → pegá todo el contenido de [`supabase/esquema.sql`](supabase/esquema.sql) → **Run**.
3. Menú **Authentication → Sign In / Providers → Email**: dejá **Email** activado y **desactivá "Confirm email"** (se entra con legajo, no se mandan correos).
4. Menú **Project Settings → API**: copiá **Project URL** y la clave **anon public**.

### 2. Conectar la página
Abrí [`js/config.js`](js/config.js) y pegá la URL y la clave *anon*:

```js
SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...',
```

> ⚠️ Nunca pongas la clave **service_role**: esa es secreta. La *anon* es pública por diseño.

### 3. Publicar en GitHub Pages
Repositorio → **Settings → Pages** → *Source*: **Deploy from a branch** → rama `main`, carpeta `/ (root)` → **Save**. En un minuto queda en
`https://<tu-usuario>.github.io/firma-electronica-policia-salta/`

### 4. Crear el primer administrador
1. Entrá a la página y creá tu cuenta con tu legajo.
2. En Supabase → **SQL Editor** ejecutá (cambiando el legajo):
   ```sql
   update public.perfiles set rol = 'admin', estado = 'activo' where legajo = 'TU_LEGAJO';
   ```
3. Volvé a ingresar: vas a ver la pestaña **Administración**, desde donde activás al resto, corregís jerarquía/dependencia/cargo, restablecés contraseñas olvidadas y borrás firmas cuyo PIN se olvidó.

## Estructura
```
index.html            Aplicación (acceso, actas, firmas, historial, administración)
verificar.html        Verificación pública por código / QR
css/estilos.css       Estilos (incluye formato de impresión A4)
js/config.js          Datos de conexión a Supabase
js/app.js             Lógica de la aplicación
js/verificar.js       Lógica de verificación
supabase/esquema.sql  Tablas, reglas de seguridad y funciones
img/escudo.svg        Ícono
```

## Aspecto legal (importante)
En Argentina la **Ley 25.506** distingue la *firma digital* (con certificado emitido por un certificador licenciado, por ejemplo en token o firma remota) de la *firma electrónica* (cualquier otro método). Este sistema es **firma electrónica**: su valor depende de que la institución la **adopte formalmente** (por ejemplo, con una resolución de Jefatura que apruebe el sistema, defina qué documentos se pueden firmar así y quién lo administra). Para actas que se agregan a expedientes judiciales, conviene consultar a Asesoría Letrada / Dirección General de Asuntos Jurídicos qué requisitos exige el Ministerio Público y el Poder Judicial de Salta.

## Próximas mejoras posibles
- Subir un PDF existente y estampar las firmas sobre él.
- Aviso por WhatsApp/correo cuando llega una solicitud de firma.
- Plantillas por tipo de acta.
- Dominio y servidor institucional.
