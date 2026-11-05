export const removeById = <T extends object>(
  items: T[],
  id: string | number,
  key: keyof T = '_id' as keyof T
): T[] => {
  const index = items.findIndex(item => item[key] === id)
  if (index !== -1) items.splice(index, 1)
  return items
}