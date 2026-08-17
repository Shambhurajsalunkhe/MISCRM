'use client'

import { useActionState, useEffect, useRef } from 'react'

import { Field, Input, Select } from '@/components/ui/field'
import { FormMessage, SubmitButton } from '@/components/ui/form'
import { IDLE } from '@/lib/form'
import { addQuotationItemAction } from '../actions'

export type ProductOption = { id: string; name: string }

/**
 * Add one line to a quotation.
 *
 * Always open, unlike the collapsible forms elsewhere: adding lines is the
 * whole activity on this screen, and the running total above it changes with
 * each one. Hiding the form behind a button would put a click between every
 * line of a five-line quote.
 */
export function QuotationItemForm({
  quotationId,
  products,
  currencySymbol,
}: {
  quotationId: string
  products: ProductOption[]
  currencySymbol: string
}) {
  const [state, formAction] = useActionState(addQuotationItemAction, IDLE)
  const formRef = useRef<HTMLFormElement>(null)
  const errors = state.fieldErrors ?? {}

  useEffect(() => {
    if (state.status === 'success') formRef.current?.reset()
  }, [state])

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3"
    >
      <input type="hidden" name="quotationId" value={quotationId} />

      <FormMessage state={state} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Description"
          htmlFor="description"
          required
          error={errors.description}
          className="lg:col-span-2"
        >
          <Input
            id="description"
            name="description"
            required
            maxLength={500}
            placeholder="What is being sold"
          />
        </Field>

        <Field label="Product" htmlFor="productId" error={errors.productId}>
          <Select id="productId" name="productId" defaultValue="">
            <option value="">Not from the catalogue</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Qty" htmlFor="quantity" error={errors.quantity}>
            <Input
              id="quantity"
              name="quantity"
              inputMode="decimal"
              defaultValue="1"
            />
          </Field>

          <Field
            label={`Unit (${currencySymbol})`}
            htmlFor="unitPrice"
            required
            error={errors.unitPrice}
          >
            <Input id="unitPrice" name="unitPrice" inputMode="decimal" required />
          </Field>
        </div>
      </div>

      <SubmitButton size="sm" variant="secondary">
        Add line
      </SubmitButton>
    </form>
  )
}
