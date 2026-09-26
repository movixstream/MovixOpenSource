// Chargé uniquement dans le chunk de polyfills legacy, avant l'application.
// Chrome 53 possède fetch, mais pas son annulation ni ResizeObserver ; son
// IntersectionObserver a aussi besoin du repli pour entry.isIntersecting.
import 'abortcontroller-polyfill/dist/polyfill-patch-fetch';
import 'intersection-observer';
import ResizeObserverPolyfill from 'resize-observer-polyfill';

if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = ResizeObserverPolyfill;
}
