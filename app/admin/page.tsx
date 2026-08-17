import { listProperties } from '../../lib/properties'
import { AdminView } from './AdminView'

export default async function AdminPage() {
  const properties = await listProperties()
  return <AdminView initialProperties={properties.map((p) => ({ id: p.id, name: p.name }))} />
}
