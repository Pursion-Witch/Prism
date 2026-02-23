async function checkPrice() {
    const item = document.getElementById('item').value.trim().toLowerCase();
    const price = parseFloat(document.getElementById('price').value);
    const resultDiv = document.getElementById('result');

    if (!item || isNaN(price)) {
        alert('Please enter both item and price');
        return;
    }

    resultDiv.classList.remove('hidden', 'bg-green-900', 'bg-yellow-900', 'bg-red-900', 'text-green-200', 'text-yellow-200', 'text-red-200');
    resultDiv.innerHTML = 'Checking...';

    try {
        const res = await fetch('/api/assess', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item, price })
        });
        const data = await res.json();

        resultDiv.innerHTML = data.message;
        if (data.flag === 'fair') {
            resultDiv.classList.add('bg-green-900', 'text-green-200');
        } else if (data.flag === 'overpriced') {
            resultDiv.classList.add('bg-yellow-900', 'text-yellow-200');
        } else if (data.flag === 'high-risk') {
            resultDiv.classList.add('bg-red-900', 'text-red-200');
        } else {
            resultDiv.classList.add('bg-gray-800', 'text-gray-300');
        }
    } catch (err) {
        resultDiv.innerHTML = 'Error contacting server';
        resultDiv.classList.add('bg-red-900', 'text-red-200');
    }
}