'use client'

// BE-49 (#115, criterium 5) — "Delen via" naast de themakeuze.
//
// Precies dezelfde voorkeur als het eerste deelblad, in de vorm van de
// instellingen: je ziet welke manieren nu gekozen zijn, kunt ze wijzigen en met
// "Wissen" terug naar het blad "Hoe deel je meestal?". Er gaat niets naar de
// server: lezen en schrijven is localStorage, in try/catch in
// src/lib/sharePreference.js. Lukt opslaan niet, dan blijft de knop werken en
// gedraagt het delen zich als het telefoonmenu (contract criterium 2).

import { useState } from 'react'
import { safeBrowserStorage } from '@/src/lib/dishList'
import {
  SHARE_SETTINGS_LABEL,
  clearSharePreference,
  readSharePreference,
  writeSharePreference,
} from '@/src/lib/sharePreference'
import { ShareDialog } from '@/src/components/ShareDialog'

export default function ShareSettingsButton() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(null)

  function handleOpen() {
    // De stand komt altijd uit de opslag zelf; er is geen tweede bron.
    setValue(readSharePreference(safeBrowserStorage()))
    setOpen(true)
  }

  function handleSave(preference) {
    const storage = safeBrowserStorage()
    if (preference) writeSharePreference(storage, preference)
    else clearSharePreference(storage)
    setValue(readSharePreference(storage))
    setOpen(false)
  }

  return (
    <div className="share-settings">
      <button
        type="button"
        className="share-settings-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={handleOpen}
      >
        {SHARE_SETTINGS_LABEL}
      </button>
      <ShareDialog
        open={open}
        mode="settings"
        value={value}
        onSave={handleSave}
        onClose={() => setOpen(false)}
        idPrefix="deel-voorkeur"
      />
    </div>
  )
}
