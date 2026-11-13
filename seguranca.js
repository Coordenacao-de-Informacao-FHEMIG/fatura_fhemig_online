// Cabecalhos de seguranca do Fatura Fhemig Online (fonte unica para o preview
// do Vite; netlify.toml e docs/IMPLANTACAO_VM.md repetem os mesmos valores).
//
// connect-src 'self' garante que a pagina e o worker so conversam com o
// proprio site: nenhum arquivo de producao pode ser enviado para fora.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const CABECALHOS_SEGURANCA = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
