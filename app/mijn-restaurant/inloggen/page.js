// BE-47 (#111) — de inlogpagina van een restauranthouder is een dunne route: alle
// logica en alle Supabase-calls zitten in app/mijn-restaurant/inloggen/
// OwnerLoginView.js en src/lib/claimEmailCodeFlow.js (getest met `node --test`).
import OwnerLoginView from './OwnerLoginView'

export default function OwnerLoginPage() {
  return <OwnerLoginView />
}
