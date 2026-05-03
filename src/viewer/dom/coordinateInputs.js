import { formatCoordinateInputValue } from '../utils.js';

export function parseCoordinateInputs({
  heightInput,
  latitudeInput,
  longitudeInput,
  setStatus,
}) {
  const latitude = Number(latitudeInput.value);
  const longitude = Number(longitudeInput.value);
  const height = Number(heightInput.value);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    setStatus('Latitude and longitude must be valid numbers.', true);
    return null;
  }

  if (!Number.isFinite(height)) {
    setStatus('Height must be a valid number.', true);
    return null;
  }

  if (latitude < -90 || latitude > 90) {
    setStatus('Latitude must be in [-90, 90].', true);
    return null;
  }

  if (longitude < -180 || longitude > 180) {
    setStatus('Longitude must be in [-180, 180].', true);
    return null;
  }

  return {
    height,
    latitude,
    longitude,
  };
}

export function setCoordinateInputs(
  { heightInput, latitudeInput, longitudeInput },
  { height, latitude, longitude },
) {
  latitudeInput.value = formatCoordinateInputValue(latitude, 8);
  longitudeInput.value = formatCoordinateInputValue(longitude, 8);
  heightInput.value = formatCoordinateInputValue(height, 3);
}
