export function getDepthAwareRenderOrder(renderOrder, reversedDepthBuffer) {
  // Three.js reverses each completed render list in reversed-depth mode, so
  // explicit renderOrder priorities must use the opposite numeric direction.
  return reversedDepthBuffer ? -renderOrder : renderOrder;
}
