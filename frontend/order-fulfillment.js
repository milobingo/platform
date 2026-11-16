export const FULFILLMENT_CHOICES = Object.freeze({
 print: 'Zelf printen',
 pickup: 'Ophalen',
 both: 'Zelf printen én ophalen',
});

export const fulfillmentLabel = choice => Object.hasOwn(FULFILLMENT_CHOICES, choice) ? FULFILLMENT_CHOICES[choice] : 'Onbekend';
export const isPickupOrder = order => ['pickup', 'both'].includes(order.fulfillmentChoice);
export const isOrderPaid = order => order.payment?.state === 'verified';
export const orderDownloadReady = order => isOrderPaid(order) && order.downloadReady === true;
export const paymentStatusLabel = order => isOrderPaid(order) ? 'Betaald' : order.status === 'payment_reported' ? 'Betaling gemeld · onbevestigd' : ['cancelled', 'rejected'].includes(order.status) ? 'Afgesloten · onbetaald' : 'Openstaand';
