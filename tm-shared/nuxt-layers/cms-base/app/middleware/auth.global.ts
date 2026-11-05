export default defineNuxtRouteMiddleware(async (to) => {
  const { user, fetchSession } = useHub()

  if (to.path === '/login') {
    return user.value ? navigateTo('/') : undefined
  }

  if (!user.value) {
    await fetchSession()
  }

  if (!user.value) {
    return navigateTo('/login')
  }
})
