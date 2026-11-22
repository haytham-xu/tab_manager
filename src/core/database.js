import { openDB } from 'idb'
import { initialState } from './model'

export function createDatabase(name = 'tab-manager-local') {
  const ready = openDB(name, 1, {
    upgrade(database) { database.createObjectStore('state') },
  })
  return {
    async load() { return await (await ready).get('state', 'current') || initialState() },
    async save(state) { await (await ready).put('state', structuredClone(state), 'current') },
    async close() { (await ready).close() },
  }
}