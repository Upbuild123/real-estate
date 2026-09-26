'use client'

import { useState } from 'react'
import styles from './admin.module.css'

type PropertyOption = { id: string; name: string; googleDriveFolderId: string | null }

function useSubmitState() {
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)

  async function submit(url: string, body: unknown, method: 'POST' | 'PATCH' = 'POST') {
    setMessage(null)
    setIsError(false)
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      if (!response.ok) {
        setIsError(true)
        setMessage(result.error ?? 'Request failed')
        return false
      }
      setMessage('Saved.')
      return true
    } catch (err) {
      setIsError(true)
      setMessage(err instanceof Error ? err.message : 'Request failed')
      return false
    }
  }

  return { message, isError, submit }
}

function StatusLine({ message, isError }: { message: string | null; isError: boolean }) {
  if (!message) return null
  return (
    <p className={styles.status} style={{ color: isError ? 'crimson' : 'green' }}>
      {message}
    </p>
  )
}

function DriveFolderRow({ property }: { property: PropertyOption }) {
  const { message, isError, submit } = useSubmitState()
  const [googleDriveFolderId, setGoogleDriveFolderId] = useState(property.googleDriveFolderId ?? '')

  async function handleSave() {
    await submit(`/api/properties/${property.id}`, { googleDriveFolderId: googleDriveFolderId || null }, 'PATCH')
  }

  return (
    <div>
      <div className={styles.propertyRow}>
        <span className={styles.propertyName}>{property.name}</span>
        <input
          value={googleDriveFolderId}
          onChange={(e) => setGoogleDriveFolderId(e.target.value)}
          placeholder="Google Drive Folder ID"
        />
        <button onClick={handleSave}>Save</button>
      </div>
      <StatusLine message={message} isError={isError} />
    </div>
  )
}

function DriveFoldersSection({ properties }: { properties: PropertyOption[] }) {
  return (
    <div className={styles.section}>
      <h2>Google Drive Folders</h2>
      <p className={styles.status}>
        Paste each property&apos;s Drive folder ID from its URL (drive.google.com/drive/folders/FOLDER_ID).
      </p>
      {properties.map((p) => (
        <DriveFolderRow key={p.id} property={p} />
      ))}
    </div>
  )
}

function AddPropertyForm({ onSaved }: { onSaved: () => void }) {
  const { message, isError, submit } = useSubmitState()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [googleDriveFolderId, setGoogleDriveFolderId] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const ok = await submit('/api/properties', { name, address, googleDriveFolderId: googleDriveFolderId || undefined })
    if (ok) {
      setName('')
      setAddress('')
      setGoogleDriveFolderId('')
      onSaved()
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <h2>Add Property</h2>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Address
        <input value={address} onChange={(e) => setAddress(e.target.value)} required />
      </label>
      <label>
        Google Drive Folder ID (optional, e.g. from the folder&apos;s URL: drive.google.com/drive/folders/FOLDER_ID)
        <input value={googleDriveFolderId} onChange={(e) => setGoogleDriveFolderId(e.target.value)} />
      </label>
      <button type="submit">Add Property</button>
      <StatusLine message={message} isError={isError} />
    </form>
  )
}

function AddLoanForm({ properties }: { properties: PropertyOption[] }) {
  const { message, isError, submit } = useSubmitState()
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? '')
  const [lender, setLender] = useState('')
  const [originalAmount, setOriginalAmount] = useState('')
  const [currentBalance, setCurrentBalance] = useState('')
  const [currentRate, setCurrentRate] = useState('')
  const [monthlyPrincipal, setMonthlyPrincipal] = useState('')
  const [originationDate, setOriginationDate] = useState('')
  const [maturityDate, setMaturityDate] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await submit('/api/loans', {
      propertyId,
      lender,
      originalAmount: Number(originalAmount),
      currentBalance: Number(currentBalance),
      currentRate: Number(currentRate),
      monthlyPrincipal: Number(monthlyPrincipal),
      originationDate,
      maturityDate,
    })
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <h2>Add Loan</h2>
      <label>
        Property
        <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} required>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Lender
        <input value={lender} onChange={(e) => setLender(e.target.value)} required />
      </label>
      <label>
        Original Amount (yen)
        <input type="number" value={originalAmount} onChange={(e) => setOriginalAmount(e.target.value)} required />
      </label>
      <label>
        Current Balance (yen)
        <input type="number" value={currentBalance} onChange={(e) => setCurrentBalance(e.target.value)} required />
      </label>
      <label>
        Current Rate (%)
        <input type="number" step="0.001" value={currentRate} onChange={(e) => setCurrentRate(e.target.value)} required />
      </label>
      <label>
        Monthly Principal (yen)
        <input type="number" value={monthlyPrincipal} onChange={(e) => setMonthlyPrincipal(e.target.value)} required />
      </label>
      <label>
        Origination Date
        <input type="date" value={originationDate} onChange={(e) => setOriginationDate(e.target.value)} required />
      </label>
      <label>
        Maturity Date
        <input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} required />
      </label>
      <button type="submit" disabled={properties.length === 0}>
        Add Loan
      </button>
      <StatusLine message={message} isError={isError} />
    </form>
  )
}

function AddAnnualCostForm({ properties }: { properties: PropertyOption[] }) {
  const { message, isError, submit } = useSubmitState()
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? '')
  const [costType, setCostType] = useState<'tax' | 'insurance' | 'depreciation'>('tax')
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [annualAmount, setAnnualAmount] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const ok = await submit('/api/annual-costs', {
      propertyId,
      costType,
      year: Number(year),
      annualAmount: Number(annualAmount),
    })
    if (ok) setAnnualAmount('')
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <h2>Add Annual Tax / Insurance / Depreciation</h2>
      <label>
        Property
        <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} required>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Type
        <select value={costType} onChange={(e) => setCostType(e.target.value as 'tax' | 'insurance' | 'depreciation')}>
          <option value="tax">Property Tax</option>
          <option value="insurance">Insurance</option>
          <option value="depreciation">Depreciation</option>
        </select>
      </label>
      <label>
        Year
        <input type="number" value={year} onChange={(e) => setYear(e.target.value)} required />
      </label>
      <label>
        Annual Amount (yen)
        <input type="number" value={annualAmount} onChange={(e) => setAnnualAmount(e.target.value)} required />
      </label>
      <button type="submit" disabled={properties.length === 0}>
        Save
      </button>
      <StatusLine message={message} isError={isError} />
    </form>
  )
}

export function AdminView({ initialProperties }: { initialProperties: PropertyOption[] }) {
  const [properties, setProperties] = useState(initialProperties)

  async function refreshProperties() {
    const response = await fetch('/api/properties')
    const data = await response.json()
    setProperties(
      data.map((p: { id: string; name: string; googleDriveFolderId: string | null }) => ({
        id: p.id,
        name: p.name,
        googleDriveFolderId: p.googleDriveFolderId,
      }))
    )
  }

  return (
    <div className={styles.page}>
      <h1>Admin</h1>
      <DriveFoldersSection properties={properties} />
      <div className={styles.section}>
        <AddPropertyForm onSaved={refreshProperties} />
      </div>
      <div className={styles.section}>
        <AddLoanForm properties={properties} />
      </div>
      <div className={styles.section}>
        <AddAnnualCostForm properties={properties} />
      </div>
    </div>
  )
}
