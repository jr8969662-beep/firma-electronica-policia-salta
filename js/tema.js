// Tema claro / oscuro. Se carga en el <head> para que no haya parpadeo.
// Sin elección guardada, sigue el tema del celular o la computadora.
(function () {
  var CLAVE = 'fe-tema';
  var raiz = document.documentElement;
  var sistema = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  var SOL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"/></svg>';
  var LUNA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z"/></svg>';

  function leer() { try { return localStorage.getItem(CLAVE); } catch (e) { return null; } }
  function guardar(v) { try { localStorage.setItem(CLAVE, v); } catch (e) { /* sin almacenamiento: vale solo para esta visita */ } }
  function aplicar(t) {
    if (t === 'light' || t === 'dark') raiz.setAttribute('data-theme', t);
    else raiz.removeAttribute('data-theme');
  }
  function actual() {
    return raiz.getAttribute('data-theme') || (sistema && sistema.matches ? 'dark' : 'light');
  }
  function pintar() {
    var oscuro = actual() === 'dark';
    var botones = document.querySelectorAll('[data-cambiar-tema]');
    for (var i = 0; i < botones.length; i++) {
      botones[i].innerHTML = oscuro ? SOL : LUNA;
      botones[i].setAttribute('aria-label', oscuro ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
      botones[i].title = oscuro ? 'Tema claro' : 'Tema oscuro';
    }
  }
  function cambiar() {
    var nuevo = actual() === 'dark' ? 'light' : 'dark';
    aplicar(nuevo);
    guardar(nuevo);
    pintar();
  }

  aplicar(leer());

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-cambiar-tema]');
    if (b) cambiar();
  });
  document.addEventListener('DOMContentLoaded', pintar);
  if (sistema && sistema.addEventListener) sistema.addEventListener('change', pintar);
})();
