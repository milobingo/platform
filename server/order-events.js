// Domain markers live in the same CAS commit as the order. A later explicit
// recovery can rebuild a missing outbox row without replaying the order action.
export function recordOrderMailEvent(order,templateId,now=Date.now(),version=1){
 const eventId=`order/${order.id}/${templateId}/${version}`;
 order.serviceEvents??=[];
 if(!order.serviceEvents.some(e=>e.eventId===eventId))order.serviceEvents.push({eventId,templateId,version,createdAt:now});
 return eventId;
}
