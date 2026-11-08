import { DatabaseBindingError, connectDatabase, getDatabaseBinding } from '#server/utils/database'

type DatabaseStatus = 'ok' | 'unconfigured' | 'error'

async function readDatabaseStatus(event: Parameters<typeof getDatabaseBinding>[0]): Promise<DatabaseStatus> {
  try {
    const connection = await connectDatabase(getDatabaseBinding(event))
    const admin = connection.db?.admin()
    if (!admin) {
      return 'error'
    }

    await admin.ping()
    return 'ok'
  } catch (error) {
    return error instanceof DatabaseBindingError && error.code === 'DATABASE_NOT_CONFIGURED'
      ? 'unconfigured'
      : 'error'
  }
}

export default defineEventHandler(async (event) => {
  const settings = getHubSettings(event)
  const database = await readDatabaseStatus(event)

  setHeader(event, 'cache-control', 'no-store')

  return successResponse({
    event,
    data: {
      // Deployment health only: no URIs, hosts, credentials or tenant ids.
      status: database === 'error' ? 'degraded' : 'ok',
      hub: settings.baseUrl && settings.appId ? 'configured' : 'unconfigured',
      database,
    },
  })
})
