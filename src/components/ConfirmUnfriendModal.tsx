import React from 'react';

interface ConfirmUnfriendModalProps {
  isOpen: boolean;
  friendUsername: string;
  onConfirm: () => void;
  onClose: () => void;
}

export const ConfirmUnfriendModal: React.FC<ConfirmUnfriendModalProps> = ({ 
  isOpen, 
  friendUsername, 
  onConfirm, 
  onClose 
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content confirm-unfriend-modal" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>&times;</button>
        
        <h2>unfriend player</h2>
        
        <div className="request-body">
          <p className="request-text">
            are you sure you want to unfriend <span className="highlight-username">@{friendUsername}</span>?
          </p>
          <p className="request-hint">
            you will no longer see each other's today's and overall play statistics on the social page.
          </p>
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            cancel
          </button>
          <button className="btn btn-danger" onClick={onConfirm}>
            unfriend
          </button>
        </div>
      </div>
    </div>
  );
};
