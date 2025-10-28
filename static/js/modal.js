// modal.js
function openModal(entry) {
    // Create modal elements
    const modal = document.createElement('div');
    const modalContent = document.createElement('div');
    const closeButton = document.createElement('button');
    
    // Add classes
    modal.classList.add('modal');
    modalContent.classList.add('modal-content');
    closeButton.classList.add('close-button');
    
    // Set content
    modalContent.innerHTML = `
        <h2>Journal Entry</h2>
        <p><strong>Date:</strong> ${new Date(entry.timestamp).toLocaleString()}</p>
        <p><strong>Content:</strong> ${entry.content}</p>
    `;
    closeButton.textContent = 'Close';
    
    // Append elements
    modalContent.appendChild(closeButton);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Open modal
    modal.style.display = 'block';
    
    // Close modal on button click
    closeButton.onclick = () => {
        modal.style.display = 'none';
        document.body.removeChild(modal);
    };
    
    // Close modal on outside click
    window.onclick = (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
            document.body.removeChild(modal);
        }
    };
}

function openModal(content) {
    document.getElementById('modalContent').textContent = content; // Set the content of the modal
    document.getElementById('journalModal').style.display = 'block'; // Show the modal
}

function closeModal() {
    document.getElementById('journalModal').style.display = 'none'; // Hide the modal
}
