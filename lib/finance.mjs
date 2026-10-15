// Integer cents only. Pending provider responses never count as money received or returned.
export function financials(booking) {
  const capturedCents = booking.capture?.status === 'COMPLETED' ? booking.depositCents : 0;
  const refundedCents = booking.refund?.status === 'COMPLETED' ? booking.depositCents : 0;
  const cancelled = booking.state === 'refunded';
  return {
    priceCents: booking.totalCents,
    depositCents: booking.depositCents,
    capturedCents, refundedCents,
    heldCents: capturedCents - refundedCents,
    depositDueCents: cancelled ? 0 : booking.depositCents - capturedCents,
    outstandingCents: cancelled ? 0 : booking.totalCents - capturedCents,
    balanceAfterDepositCents: cancelled ? 0 : booking.totalCents - booking.depositCents,
    additionalChargeCents: 0, cancelled
  };
}

export function changeEffects(booking, kind = booking.change?.approvalKind) {
  const current = financials(booking);
  return {
    kind,
    heldBeforeCents: current.heldCents,
    heldAfterCents: kind === 'refund' ? 0 : current.heldCents,
    outstandingBeforeCents: current.outstandingCents,
    outstandingAfterCents: kind === 'refund' ? 0 : current.outstandingCents,
    additionalChargeCents: 0,
    refundCents: kind === 'refund' ? current.heldCents : 0
  };
}

export const euro = cents => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
