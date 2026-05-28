import React from 'react';

interface QRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  username: string;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({ isOpen, onClose, username }) => {
  if (!isOpen) return null;

  const addFriendUrl = `${window.location.origin}/?friend=${encodeURIComponent(username)}`;
  const qrCodeImageSrc = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(addFriendUrl)}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(addFriendUrl);
    alert('Friend link copied to clipboard!');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content qr-modal" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>&times;</button>
        
        <h2 className="qr-title">your friend qr code</h2>
        <p className="qr-subtitle">let others scan this to friend you on <strong>5 letter word</strong></p>
        
        <div className="qr-container">
          <img src={qrCodeImageSrc} alt={`QR Code for ${username}`} className="qr-image" />
        </div>

        <div className="qr-link-section">
          <input 
            type="text" 
            readOnly 
            value={addFriendUrl} 
            className="qr-link-input"
            onClick={e => (e.target as HTMLInputElement).select()}
          />
          <button className="qr-copy-btn" onClick={handleCopyLink}>
            copy link
          </button>
        </div>
      </div>
    </div>
  );
};
