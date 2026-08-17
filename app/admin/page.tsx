import { listProperties } from '../../lib/properties'
import { AdminView } from './AdminView'

// Reads live DB state (the property list); must never be statically prerendered at build time.
export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const properties = await listProperties()
  return <AdminView initialProperties={properties.map((p) => ({ id: p.id, name: p.name }))} />
}
