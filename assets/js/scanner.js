// ─────────────────────────────────────────────────────────────
// SCANNER — leitura de código de barras pela câmera (html5-qrcode)
// Uso:  const codigo = await Scanner.scan();  // string, ou null (cancelou/erro)
// Requer o modal #modal-scanner no index.html e a lib html5-qrcode carregada
// ANTES deste arquivo. Roda 100% no navegador (offline, sem serviço externo).
// getUserMedia exige https OU localhost — produção (GitHub Pages) é https. ✔
// ─────────────────────────────────────────────────────────────
const Scanner = (() => {
  let instance = null;
  let resolver = null;

  // A lib expõe globais bare; com fallback pro namespace __Html5QrcodeLibrary__.
  function _lib() {
    if (typeof Html5Qrcode !== 'undefined') return Html5Qrcode;
    return (typeof window !== 'undefined' && window.__Html5QrcodeLibrary__)
      ? window.__Html5QrcodeLibrary__.Html5Qrcode : null;
  }
  function _fmts() {
    const F = (typeof Html5QrcodeSupportedFormats !== 'undefined')
      ? Html5QrcodeSupportedFormats
      : (typeof window !== 'undefined' && window.__Html5QrcodeLibrary__)
        ? window.__Html5QrcodeLibrary__.Html5QrcodeSupportedFormats : null;
    if (!F) return undefined;   // undefined = todos os formatos
    // Foco em código de barras de produto (1D) + QR.
    return [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.QR_CODE]
      .filter(v => v !== undefined);
  }

  function suportado() { return !!_lib(); }

  async function _teardown() {
    if (instance) {
      try { await instance.stop(); } catch (_) {}
      try { instance.clear(); } catch (_) {}
      instance = null;
    }
  }

  async function _finish(code) {
    const r = resolver; resolver = null;
    await _teardown();
    if (typeof Modal !== 'undefined') Modal.close('modal-scanner');
    if (r) r(code || null);
  }

  // Abre o modal, liga a câmera e resolve com o 1º código lido (ou null).
  function scan() {
    return new Promise((resolve) => {
      const Lib = _lib();
      if (!Lib) { Toast.error('Leitor de câmera não carregou. Digite o código.'); resolve(null); return; }
      resolver = resolve;
      Modal.open('modal-scanner');
      const el = document.getElementById('scanner-view');
      if (el) el.innerHTML = '';
      // pequena espera pro modal aparecer antes de abrir a câmera
      setTimeout(() => {
        try {
          instance = new Lib('scanner-view', { formatsToSupport: _fmts(), verbose: false });
          instance.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 250, height: 160 } },
            (decoded) => { _finish(decoded); },
            () => {}   // erros por frame (código não encontrado) — ignora
          ).catch(err => {
            Toast.error('Não deu pra abrir a câmera: ' + (err && err.message ? err.message : err));
            _finish(null);
          });
        } catch (err) {
          Toast.error('Erro no leitor: ' + (err && err.message ? err.message : err));
          _finish(null);
        }
      }, 150);
    });
  }

  function cancel() { _finish(null); }

  return { scan, cancel, suportado };
})();
