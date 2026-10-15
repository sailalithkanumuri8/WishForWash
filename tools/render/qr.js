// QR code that points at the deployed site (regenerated from the poster's QR card).
import QRCode from 'qrcode';

export default async function renderQr({ siteUrl, escapeHtml }) {
  const svg = await QRCode.toString(siteUrl, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: '#0E2A4F', light: '#FFFFFF' },
  });
  return svg.replace(
    '<svg ',
    `<svg class="qr__code" role="img" aria-label="QR code that opens ${escapeHtml(siteUrl)}" `,
  );
}
