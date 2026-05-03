const { InspectorError } = require('../../errors');
const { normalizeMatrix4Array } = require('./normalize');
const { getNodeLocalMatrix } = require('./gltfResource');

function getTileLocalTransform(THREE, tile) {
  const matrix = new THREE.Matrix4();
  if (Array.isArray(tile?.transform)) {
    matrix.fromArray(normalizeMatrix4Array(tile.transform, 'tile.transform'));
  }
  return matrix;
}

function getTileWorldTransform(THREE, tile, parentTransform) {
  const matrix = getTileLocalTransform(THREE, tile);
  if (parentTransform) {
    matrix.premultiply(parentTransform);
  }
  return matrix;
}

function getRootUpRotationMatrix(THREE, tileset) {
  const axis =
    typeof tileset?.asset?.gltfUpAxis === 'string'
      ? tileset.asset.gltfUpAxis.toLowerCase()
      : 'y';
  const matrix = new THREE.Matrix4();

  if (axis === 'x') {
    matrix.makeRotationY(-Math.PI / 2);
  } else if (axis === 'y') {
    matrix.makeRotationX(Math.PI / 2);
  } else if (axis !== 'z') {
    throw new InspectorError(`Unsupported asset.gltfUpAxis value: ${axis}`);
  }

  return matrix;
}

function primitiveHasGaussianSpzExtension(primitive) {
  return (
    primitive?.extensions?.KHR_gaussian_splatting?.extensions
      ?.KHR_gaussian_splatting_compression_spz_2 != null
  );
}

function collectGaussianPrimitiveDescriptors(
  THREE,
  json,
  tileSceneMatrix,
  tileProjectionMatrix = tileSceneMatrix,
) {
  const descriptors = [];
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const scenes = Array.isArray(json.scenes) ? json.scenes : [];
  const sceneIndex = Number.isInteger(json.scene) ? json.scene : 0;
  const rootNodeIndices = Array.isArray(scenes[sceneIndex]?.nodes)
    ? scenes[sceneIndex].nodes
    : nodes.map((_, index) => index);

  function visitNode(
    nodeIndex,
    parentSceneMatrix,
    parentProjectionMatrix,
    stack,
  ) {
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodes.length) {
      return;
    }
    if (stack.has(nodeIndex)) {
      throw new InspectorError('glTF node hierarchy contains a cycle.');
    }

    const node = nodes[nodeIndex];
    if (!node || typeof node !== 'object') {
      return;
    }

    stack.add(nodeIndex);
    const nodeLocalMatrix = getNodeLocalMatrix(THREE, node);
    const nodeWorldMatrix = nodeLocalMatrix.clone().premultiply(parentSceneMatrix);
    const nodeProjectionMatrix = nodeLocalMatrix
      .clone()
      .premultiply(parentProjectionMatrix);

    if (Number.isInteger(node.mesh)) {
      const mesh = meshes[node.mesh];
      if (mesh && Array.isArray(mesh.primitives)) {
        mesh.primitives.forEach((primitive, primitiveIndex) => {
          const gaussianExtension =
            primitive?.extensions?.KHR_gaussian_splatting?.extensions
              ?.KHR_gaussian_splatting_compression_spz_2;
          const bufferView = gaussianExtension?.bufferView;
          if (bufferView == null) {
            if (primitive?.extensions?.KHR_gaussian_splatting) {
              throw new InspectorError(
                'Only KHR_gaussian_splatting_compression_spz_2 Gaussian primitives are supported for crop deletion.',
              );
            }
            return;
          }
          if (!Number.isInteger(bufferView)) {
            throw new InspectorError('Gaussian SPZ bufferView must be an integer.');
          }
          descriptors.push({
            bufferView,
            meshIndex: node.mesh,
            primitiveIndex,
            sourceToProjectionMatrix: nodeProjectionMatrix.clone(),
            sourceToWorldMatrix: nodeWorldMatrix.clone(),
          });
        });
      }
    }

    if (Array.isArray(node.children)) {
      node.children.forEach((childIndex) => {
        visitNode(childIndex, nodeWorldMatrix, nodeProjectionMatrix, stack);
      });
    }
    stack.delete(nodeIndex);
  }

  rootNodeIndices.forEach((nodeIndex) => {
    visitNode(nodeIndex, tileSceneMatrix, tileProjectionMatrix, new Set());
  });

  return descriptors;
}

function hasNonGaussianScenePrimitives(json) {
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const scenes = Array.isArray(json.scenes) ? json.scenes : [];
  const sceneIndex = Number.isInteger(json.scene) ? json.scene : 0;
  const rootNodeIndices = Array.isArray(scenes[sceneIndex]?.nodes)
    ? scenes[sceneIndex].nodes
    : nodes.map((_, index) => index);
  const visited = new Set();

  function visitNode(nodeIndex) {
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodes.length) {
      return false;
    }
    if (visited.has(nodeIndex)) {
      return false;
    }

    visited.add(nodeIndex);
    const node = nodes[nodeIndex];
    const mesh = Number.isInteger(node?.mesh) ? meshes[node.mesh] : null;
    if (
      Array.isArray(mesh?.primitives) &&
      mesh.primitives.some((primitive) => !primitiveHasGaussianSpzExtension(primitive))
    ) {
      return true;
    }

    if (!Array.isArray(node?.children)) {
      return false;
    }

    return node.children.some(visitNode);
  }

  return rootNodeIndices.some(visitNode);
}

function hasScenePrimitives(json) {
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const scenes = Array.isArray(json.scenes) ? json.scenes : [];
  const sceneIndex = Number.isInteger(json.scene) ? json.scene : 0;
  const rootNodeIndices = Array.isArray(scenes[sceneIndex]?.nodes)
    ? scenes[sceneIndex].nodes
    : nodes.map((_, index) => index);
  const visited = new Set();

  function visitNode(nodeIndex) {
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodes.length) {
      return false;
    }
    if (visited.has(nodeIndex)) {
      return false;
    }

    visited.add(nodeIndex);
    const node = nodes[nodeIndex];
    const mesh = Number.isInteger(node?.mesh) ? meshes[node.mesh] : null;
    if (Array.isArray(mesh?.primitives) && mesh.primitives.length > 0) {
      return true;
    }

    if (!Array.isArray(node?.children)) {
      return false;
    }

    return node.children.some(visitNode);
  }

  return rootNodeIndices.some(visitNode);
}

function removeMeshPrimitives(resource, descriptors) {
  const removals = new Map();
  descriptors.forEach((descriptor) => {
    if (
      !Number.isInteger(descriptor.meshIndex) ||
      !Number.isInteger(descriptor.primitiveIndex)
    ) {
      return;
    }
    removals.set(
      `${descriptor.meshIndex}:${descriptor.primitiveIndex}`,
      descriptor,
    );
  });

  const ordered = Array.from(removals.values()).sort((left, right) => {
    if (left.meshIndex !== right.meshIndex) {
      return right.meshIndex - left.meshIndex;
    }
    return right.primitiveIndex - left.primitiveIndex;
  });

  let removed = 0;
  ordered.forEach((descriptor) => {
    const primitives = resource.json.meshes?.[descriptor.meshIndex]?.primitives;
    if (
      Array.isArray(primitives) &&
      descriptor.primitiveIndex >= 0 &&
      descriptor.primitiveIndex < primitives.length
    ) {
      primitives.splice(descriptor.primitiveIndex, 1);
      removed += 1;
    }
  });

  return removed;
}

module.exports = {
  collectGaussianPrimitiveDescriptors,
  getRootUpRotationMatrix,
  getTileLocalTransform,
  getTileWorldTransform,
  hasNonGaussianScenePrimitives,
  hasScenePrimitives,
  removeMeshPrimitives,
};
