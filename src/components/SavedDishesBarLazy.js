'use client'

// BE-65 (#157, uitkomst 3) — de lezer die de balk pas laat laden als er iets
// bewaard is (Lead-review ronde 3, punt 3).
//
// Waarom dit aparte bestand bestaat: de balk zelf (SavedDishesBar met zijn
// opmaak, sluitknop en link) hoorde bij het eerste JS-pakket van / en
// /search, ook als er niets bewaard was. Deze lezer is een paar honderd bytes:
// hij kijkt bij het laden naar het aantal en luistert naar het bewaar-event.
// Pas bij een aantal van één of meer laadt hij de balk via `next/dynamic`, dus
// buiten de eerste lading. Het gedrag blijft gelijk: bewaren toont de balk
// meteen, sluiten verbergt hem voor deze sessie.

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { SAVED_LIST_EVENT_NAME, browserStorage, savedCount } from '@/src/lib/savedListRead'

const SavedDishesBar = dynamic(() => import('./SavedDishesBar'), { loading: () => null })

export default function SavedDishesBarLazy() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const sync = () => setShow(savedCount(browserStorage()) > 0)
    sync()
    window.addEventListener(SAVED_LIST_EVENT_NAME, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(SAVED_LIST_EVENT_NAME, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return show ? <SavedDishesBar /> : null
}
