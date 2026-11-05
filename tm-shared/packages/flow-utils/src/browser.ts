import { isIconify, isRawSvg } from './svg'
import { toSlug } from './slug'

export type CsvRow = (string | number | null | undefined)[]

export const exportToCsv = (filename: string, headers: string[], rows: CsvRow[]): void => {
  const escapeCsv = (val: unknown): string => {
    const str = String(val ?? '')
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"`
      : str
  }

  const csvContent = [
    headers.map(escapeCsv).join(','),
    ...rows.map(row => row.map(escapeCsv).join(','))
  ].join('\n')

  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const doc = (globalThis as { document?: Document }).document
  if (!doc) return
  const link = doc.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', `${filename}.csv`)
  doc.body.appendChild(link)
  link.click()
  doc.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export const exportToJson = (filename: string, data: unknown): void => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const doc = (globalThis as { document?: Document }).document
  if (!doc) return
  const link = doc.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', `${filename}.json`)
  doc.body.appendChild(link)
  link.click()
  doc.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export const readCsv = (csvText: string): Record<string, string>[] => {
  const cleanCsv = csvText.startsWith('\ufeff') ? csvText.slice(1) : csvText
  const lines = cleanCsv.trim().split(/\r?\n/)
  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0] || '')
  const result: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const currentLine = parseCsvLine(lines[i] || '')
    if (currentLine.length === headers.length) {
      const obj: Record<string, string> = {}
      headers.forEach((header, index) => {
        obj[header.trim()] = currentLine[index]?.trim() || ''
      })
      result.push(obj)
    }
  }

  return result
}

export const readJson = (jsonText: string): unknown[] => {
  const data = JSON.parse(jsonText) as unknown
  return Array.isArray(data) ? data : [data]
}

const parseCsvLine = (line: string): string[] => {
  const result: string[] = []
  let startValueIndex = 0
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      let value = line.substring(startValueIndex, i)
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/""/g, '"')
      }
      result.push(value)
      startValueIndex = i + 1
    }
  }

  let lastValue = line.substring(startValueIndex)
  if (lastValue.startsWith('"') && lastValue.endsWith('"')) {
    lastValue = lastValue.slice(1, -1).replace(/""/g, '"')
  }
  result.push(lastValue)

  return result
}

export const downloadFile = async (url: string, filename?: string): Promise<void> => {
  if (!url) return

  let ext = 'bin'
  const urlExtMatch = url.match(/\.([a-z0-9]+)(?:[?#]|$)/i)
  if (urlExtMatch) ext = urlExtMatch[1] as string

  const getCleanFilename = (baseName: string, fallbackExt: string): string => {
    const lastDotIndex = baseName.lastIndexOf('.')
    let namePart = baseName
    let extPart = fallbackExt

    if (lastDotIndex !== -1 && lastDotIndex > 0) {
      const possibleExt = baseName.substring(lastDotIndex + 1).toLowerCase()
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'mp3', 'mp4', 'zip', 'json', 'csv'].includes(possibleExt)) {
        namePart = baseName.substring(0, lastDotIndex)
        extPart = possibleExt
      }
    }

    return `${toSlug(namePart)}.${extPart}`
  }

  if (isRawSvg(url)) {
    const doc = (globalThis as { document?: Document }).document
    if (!doc) return
    const finalFilename = getCleanFilename(filename || 'image', 'svg')
    const blob = new Blob([url], { type: 'image/svg+xml' })
    const blobUrl = URL.createObjectURL(blob)
    const link = doc.createElement('a')
    link.href = blobUrl
    link.download = finalFilename
    doc.body.appendChild(link)
    link.click()
    doc.body.removeChild(link)
    URL.revokeObjectURL(blobUrl)
    return
  }

  if (isIconify(url)) {
    console.warn('Downloading Iconify icons directly is not supported yet.')
    return
  }

  try {
    const response = await fetch(url)
    const blob = await response.blob()
    const contentType = response.headers.get('content-type')

    if (contentType) {
      if (contentType.includes('image/png')) ext = 'png'
      else if (contentType.includes('image/jpeg')) ext = 'jpg'
      else if (contentType.includes('image/gif')) ext = 'gif'
      else if (contentType.includes('image/webp')) ext = 'webp'
      else if (contentType.includes('image/svg+xml')) ext = 'svg'
      else if (contentType.includes('application/pdf')) ext = 'pdf'
      else if (contentType.includes('audio/')) ext = contentType.split('/')[1] || 'mp3'
      else if (contentType.includes('video/')) ext = contentType.split('/')[1] || 'mp4'
    }

    const doc = (globalThis as { document?: Document }).document
    if (!doc) return
    const finalFilename = getCleanFilename(filename || 'download', ext)
    const blobUrl = URL.createObjectURL(blob)
    const link = doc.createElement('a')
    link.href = blobUrl
    link.download = finalFilename
    doc.body.appendChild(link)
    link.click()
    doc.body.removeChild(link)
    URL.revokeObjectURL(blobUrl)
  } catch (error) {
    console.error('Download error:', error)
    const doc = (globalThis as { document?: Document }).document
    if (!doc) return
    const link = doc.createElement('a')
    link.href = url
    link.target = '_blank'
    const finalFallbackName = getCleanFilename(filename || 'download', ext)
    link.download = finalFallbackName
    doc.body.appendChild(link)
    link.click()
    doc.body.removeChild(link)
  }
}