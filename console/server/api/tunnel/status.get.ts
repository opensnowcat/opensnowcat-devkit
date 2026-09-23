import QRCode from 'qrcode'

export default defineEventHandler(async () => {
  const status = await tunnelStatus()
  const qr = status.url ? await QRCode.toDataURL(status.url, { margin: 1, width: 180, color: { dark: '#ffffffff', light: '#00000000' } }) : null
  return { ...status, qr }
})
