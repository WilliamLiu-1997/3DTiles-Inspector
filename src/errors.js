class InspectorError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InspectorError';
  }
}

module.exports = {
  InspectorError,
};
