import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import QrImage from '../components/QrImage';
import EmptyState from '../components/EmptyState';

export default function CustomInviteCard() {
  const { token } = useParams();
  const [invite, setInvite] = useState(null);
  const [event, setEvent] = useState(null);
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadInvite();
  }, [token]);

  const loadInvite = async () => {
    try {
      const data = await api.get(`/custom-invite/${token}`);
      setInvite(data.invite);
      setEvent(data.event);
      setMedia(data.media || []);
    } catch (err) {
      console.error('Failed to load invite:', err);
    } finally {
      setLoading(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(checkinLink);
    setCopied(true);
    toast.success('Link copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return <div className="pt-4 text-center">Loading...</div>;
  if (!invite || !event) return <EmptyState title="Invalid Invitation" message="This invitation is not valid or has expired." />;

  const cardLink = window.location.href;
  const checkinLink = `${window.location.origin}/custom-invite/${token}`;

  // Add print styles
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @media print {
        .no-print {
          display: none !important;
        }
        #invite-card {
          box-shadow: none !important;
          border: 2px solid black !important;
        }
      }
    `;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  return (
    <div className="pt-4 pb-8 animate-fade-in">
      <div className="max-w-2xl mx-auto no-print">
        <div className="flex items-center justify-between mb-4 px-1">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight">Invitation Card</h1>
            <p className="text-[13px] text-[var(--color-text-secondary)]">Share this beautiful invitation with your guests</p>
          </div>
          <button
            onClick={() => window.print()}
            className="btn btn-primary btn-sm"
          >
            Print Card
          </button>
        </div>
      </div>

      {/* Printable Card */}
      <div id="invite-card" className="max-w-2xl mx-auto bg-white overflow-hidden rounded-2xl border-2 border-black print:border-0 print:rounded-none print:max-w-none shadow-2xl">
        {/* Header Band */}
        <div className="text-white text-center px-8 pt-8 pb-6" style={{ backgroundColor: '#ff3b30' }}>
          <p className="text-xs font-bold tracking-[0.3em] uppercase opacity-80 mb-2">You're Invited To</p>
          <h1 className="text-4xl font-black tracking-tight leading-none">{event.name}</h1>
          {(event.venue || event.date) && (
            <p className="text-lg font-semibold mt-2 opacity-90">
              {[event.venue, event.date].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        {/* Invitation Details */}
        <div className="px-8 pt-8 pb-6">
          <div className="text-center mb-6">
            <div className="inline-block px-4 py-2 rounded-full text-sm font-bold mb-4" style={{ backgroundColor: '#ff3b30', color: 'white' }}>
              {invite.name}
            </div>
            {invite.description && (
              <p className="text-lg leading-relaxed" style={{ color: '#1c1c1e' }}>{invite.description}</p>
            )}
          </div>

          {event.description && (
            <div className="rounded-xl p-4 mb-6" style={{ backgroundColor: '#f5f5f7' }}>
              <p className="text-sm leading-relaxed" style={{ color: '#636366' }}>{event.description}</p>
            </div>
          )}

          {/* Media Gallery */}
          {media.length > 0 && (
            <div className="mb-6">
              <p className="text-sm font-semibold mb-3" style={{ color: '#1c1c1e' }}>Media</p>
              <div className="grid grid-cols-2 gap-3">
                {media.map((item) => (
                  <div key={item.id} className="rounded-xl overflow-hidden" style={{ backgroundColor: '#f5f5f7' }}>
                    {item.media_type === 'image' && (
                      <img
                        src={item.url}
                        alt={item.alt_text || ''}
                        className="w-full h-32 object-cover"
                      />
                    )}
                    {item.media_type === 'video' && (
                      <video
                        src={item.url}
                        controls
                        className="w-full h-32 object-cover"
                      />
                    )}
                    {item.media_type === 'document' && (
                      <div className="p-4 text-center">
                        <svg className="w-8 h-8 mx-auto mb-2" style={{ color: '#636366' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <p className="text-xs" style={{ color: '#636366' }}>{item.alt_text || 'Document'}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Event Details Grid */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {event.date && (
              <div className="rounded-xl p-4 text-center" style={{ backgroundColor: '#f5f5f7' }}>
                <svg className="w-6 h-6 mx-auto mb-2" style={{ color: '#636366' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 3l4 4m0 0l4-4M4 4v4m0 0l-4-4m4 4H4" />
                </svg>
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: '#636366' }}>Date</p>
                <p className="font-semibold text-sm" style={{ color: '#1c1c1e' }}>{event.date}</p>
              </div>
            )}
            {event.venue && (
              <div className="rounded-xl p-4 text-center" style={{ backgroundColor: '#f5f5f7' }}>
                <svg className="w-6 h-6 mx-auto mb-2" style={{ color: '#636366' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: '#636366' }}>Venue</p>
                <p className="font-semibold text-sm" style={{ color: '#1c1c1e' }}>{event.venue}</p>
              </div>
            )}
          </div>

          {/* QR Code */}
          <div className="flex justify-center mb-6">
            <div className="border-4 rounded-2xl p-4 shadow-lg" style={{ borderColor: '#d2d2d7', backgroundColor: '#ffffff' }}>
              <QrImage value={checkinLink} size={200} />
            </div>
          </div>

          {/* Instructions */}
          <div className="text-center space-y-2 mb-6">
            <p className="text-sm font-semibold" style={{ color: '#1c1c1e' }}>How to check in:</p>
            <div className="flex items-center justify-center gap-2 text-sm" style={{ color: '#636366' }}>
              <span className="flex items-center gap-1">
                <span className="w-6 h-6 rounded-full font-bold flex items-center justify-center text-xs" style={{ backgroundColor: '#ff3b30', color: 'white' }}>1</span>
                <span>Scan this QR code</span>
              </span>
              <span style={{ color: '#aeaeb2' }}>→</span>
              <span className="flex items-center gap-1">
                <span className="w-6 h-6 rounded-full font-bold flex items-center justify-center text-xs" style={{ backgroundColor: '#ff3b30', color: 'white' }}>2</span>
                <span>Enter your name</span>
              </span>
              <span style={{ color: '#aeaeb2' }}>→</span>
              <span className="flex items-center gap-1">
                <span className="w-6 h-6 rounded-full font-bold flex items-center justify-center text-xs" style={{ backgroundColor: '#ff3b30', color: 'white' }}>3</span>
                <span>You're checked in!</span>
              </span>
            </div>
          </div>

          {/* Link Display */}
          <div className="rounded-xl p-4 break-all" style={{ backgroundColor: '#f5f5f7' }}>
            <p className="text-xs mb-1" style={{ color: '#636366' }}>Or visit this link:</p>
            <p className="text-sm font-mono" style={{ color: '#1c1c1e' }}>{checkinLink}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="mx-8 mt-6 mb-8 border-t-2 border-dashed pt-4 text-center" style={{ borderColor: '#d2d2d7' }}>
          <p className="text-sm font-bold" style={{ color: '#1c1c1e' }}>Need help?</p>
          <p className="text-xs mt-1" style={{ color: '#636366' }}>Show this invitation to staff at the entrance</p>
        </div>
      </div>

      {/* Copy Button (no-print) */}
      <div className="max-w-2xl mx-auto mt-4 no-print">
        <button
          onClick={copyLink}
          className="btn btn-primary w-full flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {copied ? 'Copied!' : 'Copy Invitation Link'}
        </button>
      </div>
    </div>
  );
}
