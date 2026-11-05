import { UAParser } from 'ua-parser-js'

export const parseUserAgent = (userAgentString: string) => {
  const parser = new UAParser(userAgentString)
  const browser = parser.getBrowser()
  const os = parser.getOS()
  const device = parser.getDevice()

  const browserName = browser.name || 'Unknown Browser'
  const osName = os.name || 'Unknown OS'
  const osVersion = os.version ? ` ${os.version}` : ''

  let deviceName = `${browserName} on ${osName}${osVersion}`

  if (device.vendor && device.model) {
    deviceName += ` (${device.vendor} ${device.model})`
  }

  let icon = 'i-lucide-monitor'
  const type = device.type
  if (type === 'mobile') icon = 'i-lucide-smartphone'
  if (type === 'tablet') icon = 'i-lucide-tablet'

  return {
    readable: deviceName,
    browser: browser,
    os: os,
    device: device,
    icon: icon
  }
}