'use client'

// BE-44 (#105, criterium 4) — de pagina "Mijn lijstje" en het gedeelde lijstje.
//
// Eigen lijstje (zonder `?lijst=`): de gerechten komen uit localStorage, met
// per regel het gerecht, het restaurant en de prijs, een knop om er één weg te
// halen en "Lijstje delen". Kan de browser niet opslaan, dan blijft de pagina
// werken en is het lijstje gewoon leeg.
//
// Gedeeld lijstje (met `?lijst=`): de server heeft de id's al opgezocht
// (app/mijn-lijstje/page.js). De ontvanger ziet "Gedeeld lijstje · <n>
// gerechten", elk gerecht is aan te tikken, en met "Zet ze op mijn eigen
// lijstje" komen ze in zijn eigen opslag. Wat niet meer bestaat, is al
// overgeslagen; deze pagina zegt hoeveel.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import ThemeToggle from '@/src/components/ThemeToggle'
import ShareSettingsButton from '@/src/components/ShareSettingsButton'
import MobileTabBar from '@/src/components/MobileTabBar'
import ListShareButton from '@/src/components/ListShareButton'
import Wordmark from '@/src/components/Wordmark'
import {
  ADD_TO_OWN_LIST_LABEL,
  LIST_PAGE,
  NOT_AVAILABLE_MESSAGE,
  REMOVE_LABEL,
  SAVED_LIST_EVENT,
  VIEW_LIST_LABEL,
  addSavedDishes,
  dishCountLabel,
  listDishHref,
  listShareHref,
  readSavedList,
  safeBrowserStorage,
  sharedListHeading,
  toggleSavedDish,
} from '@/src/lib/dishList'

const ADDED_MESSAGE = 'Op je lijstje gezet'
const ADD_FAILED_MESSAGE = 'Bewaren lukt niet op dit apparaat'

function DishRow({ entry, theme, onRemove }) {
  const href = listDishHref(entry, theme) || `/menu/${entry.menuId}`
  return (
    <li className="lijst-row">
      <Link href={href} className="lijst-row-link">
        <span className="lijst-row-name">{entry.name}</span>
        <span className="lijst-row-meta">{entry.restaurant}</span>
        <span className="lijst-row-price">{entry.price}</span>
      </Link>
      {onRemove ? (
        <button
          type="button"
          className="lijst-remove"
          onClick={() => onRemove(entry)}
          aria-label={`${REMOVE_LABEL}: ${entry.name}`}
        >
          ×
        </button>
      ) : null}
    </li>
  )
}

export default function MijnLijstjeView({ shared = false, sharedDishes = [], skipped = 0, stand = 'licht' }) {
  const [own, setOwn] = useState([])
  const [message, setMessage] = useState('')

  const refresh = useCallback(() => setOwn(readSavedList(safeBrowserStorage())), [])

  useEffect(() => {
    if (shared) return undefined
    refresh()
    window.addEventListener(SAVED_LIST_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(SAVED_LIST_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [shared, refresh])

  const handleRemove = useCallback((entry) => {
    const result = toggleSavedDish(safeBrowserStorage(), entry)
    setOwn(result.entries)
    window.dispatchEvent(new Event(SAVED_LIST_EVENT))
  }, [])

  const handleAddAll = useCallback(() => {
    const result = addSavedDishes(safeBrowserStorage(), sharedDishes)
    setMessage(result.ok ? ADDED_MESSAGE : ADD_FAILED_MESSAGE)
    window.dispatchEvent(new Event(SAVED_LIST_EVENT))
  }, [sharedDishes])

  return (
    <>
      <header>
        <div className="header-inner">
          <Wordmark />
          <div className="lijst-header-actions">
            <ThemeToggle />
            <ShareSettingsButton />
            <Link href="/" className="back-btn">← Home</Link>
          </div>
        </div>
      </header>

      <main className="lijst-main">
        <h1 className="lijst-title">
          {shared ? sharedListHeading(sharedDishes.length) : 'Mijn lijstje'}
        </h1>

        {shared ? (
          <>
            {skipped > 0 ? (
              <p className="lijst-skipped">{NOT_AVAILABLE_MESSAGE}: {skipped}</p>
            ) : null}
            {sharedDishes.length > 0 ? (
              <ul className="lijst-rows">
                {sharedDishes.map((entry) => (
                  <DishRow key={entry.id} entry={entry} theme={stand} />
                ))}
              </ul>
            ) : (
              <p className="lijst-empty">Dit lijstje is leeg of de gerechten bestaan niet meer.</p>
            )}
            <div className="lijst-actions">
              <button
                type="button"
                className="lijst-primary-btn lijst-add-btn"
                onClick={handleAddAll}
                disabled={sharedDishes.length === 0}
              >
                {ADD_TO_OWN_LIST_LABEL}
              </button>
              <span className="lijst-status" role="status">{message}</span>
              {message ? (
                <Link href={LIST_PAGE} className="lijst-link">{VIEW_LIST_LABEL}</Link>
              ) : null}
            </div>
          </>
        ) : own.length === 0 ? (
          <>
            <p className="lijst-empty">Je lijstje is nog leeg. Bewaar een gerecht op een menukaart.</p>
            <Link href="/alle-restaurants" className="lijst-link">Bekijk de menukaarten →</Link>
          </>
        ) : (
          <>
            <ul className="lijst-rows">
              {own.map((entry) => (
                <DishRow key={entry.id} entry={entry} onRemove={handleRemove} />
              ))}
            </ul>
            <div className="lijst-actions">
              <ListShareButton
                href={listShareHref({ values: own })}
                title={`Mijn lijstje · ${dishCountLabel(own.length)}`}
              />
            </div>
          </>
        )}
      </main>

      <MobileTabBar />
    </>
  )
}
