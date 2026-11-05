export const getRandomInteger = (min: number, max: number): number => {
  const lo = Math.ceil(min)
  const hi = Math.floor(max)
  return Math.floor(Math.random() * (hi - lo + 1)) + lo
}

export const generateEan13 = (): string => {
  const result: number[] = []
  for (let i = 0; i < 12; i++) {
    result.push(Math.floor(Math.random() * 10))
  }
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += (result[i] as number) * (i % 2 === 0 ? 1 : 3)
  }
  const checksum = (10 - (sum % 10)) % 10
  result.push(checksum)
  return result.join('')
}

export const generateCode = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}