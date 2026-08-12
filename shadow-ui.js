(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeShadowUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function insertHost(host, target, position) {
    if (!target) return false;
    if (position === 'append') {
      target.appendChild(host);
      return true;
    }
    if (!target.parentElement) return false;
    target.parentElement.insertBefore(host, position === 'before' ? target : target.nextSibling);
    return true;
  }

  function mountElement(element, target, position = 'after') {
    if (!element || !target || typeof element !== 'object') return null;
    const id = element.id || '';
    const host = document.createElement('span');
    if (id) host.id = id;
    host.className = 'amze-shadow-host';
    host.setAttribute('data-amze-shadow-host', '1');
    const shadow = host.attachShadow({ mode: 'open' });
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = chrome.runtime.getURL('shadow-ui.css');
    shadow.appendChild(stylesheet);
    shadow.appendChild(element);
    if (!insertHost(host, target, position)) return null;
    return { host, shadow, element };
  }

  return { mountElement };
});
