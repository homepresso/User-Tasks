import { FormLoading } from '@/components/forms/form-loading'

/** /fill/<id> in the app shell: the form card's skeleton while the route loads (then StandaloneForm's own, same shape). */
export default function FillFormLoading() {
  return (
    <div className="py-2">
      <FormLoading />
    </div>
  )
}
