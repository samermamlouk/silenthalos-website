(function () {
  const params = new URLSearchParams(window.location.search);
  const incidentId = params.get('id') || params.get('incident') || 'UNKNOWN';

  const idElement = document.getElementById('incidentId');
  const timeElement = document.getElementById('incidentTime');
  const statusElement = document.getElementById('incidentStatus');

  if (idElement) {
    idElement.textContent = incidentId;
  }

  if (timeElement) {
    timeElement.textContent = new Date().toLocaleString();
  }

  if (statusElement) {
    statusElement.textContent = incidentId === 'UNKNOWN'
      ? 'No incident ID provided'
      : 'Incident page ready - cloud sync pending';
  }
})();
