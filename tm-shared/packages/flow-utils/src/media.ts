export const getYoutubeId = (url: string): string | null => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/
  const id = url.match(regExp)?.[2]
  return id && id.length === 11 ? id : null
}

export const getYoutubeEmbedUrl = (url: string): string => {
  const id = getYoutubeId(url)
  return id ? `https://www.youtube.com/embed/${id}` : ''
}

export const getVimeoId = (url: string): string | null => {
  const match = url.match(/(?:www\.|player\.)?vimeo.com\/(?:channels\/(?:\w+\/)?|groups\/(?:[^/]*)\/videos\/|album\/(?:\d+)\/video\/|video\/|)(\d+)(?:[a-zA-Z0-9_-]+)?/)
  return match?.[1] ?? null
}

export const getVimeoEmbedUrl = (url: string): string => {
  const id = getVimeoId(url)
  return id ? `https://player.vimeo.com/video/${id}` : ''
}

export const getFacebookId = (url: string): string | null => {
  const match = url.match(/(?:facebook\.com\/(?:video\.php\?v=|watch\/\?v=|watch\/)|fb\.watch\/)([a-zA-Z0-9_-]+)/)
  return match?.[1] ?? null
}

export const getFacebookEmbedUrl = (url: string): string => {
  const id = getFacebookId(url)
  return id ? `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=0` : ''
}

export const getSoundCloudEmbedUrl = (url: string): string => {
  if (!url.includes('soundcloud.com')) return ''
  return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff5500&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true`
}

export const getTiktokId = (url: string): string | null => {
  const match = url.match(/tiktok\.com\/.*\/video\/(\d+)/)
  return match?.[1] ?? null
}

export const getTiktokEmbedUrl = (url: string): string => {
  const id = getTiktokId(url)
  return id ? `https://www.tiktok.com/embed/v2/${id}` : ''
}

export const getDailyMotionId = (url: string): string | null => {
  const match = url.match(/(?:dailymotion\.com\/video\/|dai\.ly\/)([a-zA-Z0-9]+)/)
  return match?.[1] ?? null
}

export const getDailyMotionEmbedUrl = (url: string): string => {
  const id = getDailyMotionId(url)
  return id ? `https://www.dailymotion.com/embed/video/${id}` : ''
}