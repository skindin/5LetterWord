import React from 'react';

interface AcceptFriendModalProps {
  isOpen: boolean;
  friendUsername: string;
  onAccept: () => void;
  onClose: () => void;
}

export const AcceptFriendModal: React.FC<AcceptFriendModalProps> = ({ 
  isOpen, 
  friendUsername, 
  onAccept, 
  onClose 
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content accept-friend-modal" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>&times;</button>
        
        <h2>friend request</h2>
        
        <div className="request-body">
          <p className="request-text">
            would you like to accept a friend request from <span className="highlight-username">@{friendUsername}</span>?
          </p>
          <p className="request-hint">
            becoming friends allows you to see each other's today's and overall play statistics!
          </p>
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            decline
          </button>
          <button className="btn btn-primary" onClick={onAccept}>
            accept & friend
          </button>
        </div>
      </div>
    </div>
  );
};
