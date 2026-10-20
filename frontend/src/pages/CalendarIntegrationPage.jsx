import { useState } from 'react';
import toast from 'react-hot-toast';

export default function CalendarIntegration() {
  const [provider, setProvider] = useState('google');
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const providers = [
    { key: 'google', label: 'Google Calendar', icon: '📅' },
    { key: 'outlook', label: 'Outlook/Exchange', icon: '📧' },
    { key: 'apple', label: 'Apple Calendar', icon: '🍎' },
  ];

  const handleConnect = async () => {
    toast.info(`${providers.find(p => p.key === provider)?.label} integration coming soon`);
  };

  const handleSync = async () => {
    setSyncing(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    setSyncing(false);
    toast.success('Calendar synced successfully');
  };

  const handleDisconnect = async () => {
    setConnected(false);
    toast.success('Calendar disconnected');
  };

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1">
        <h1 className="text-[22px] font-bold tracking-tight">Calendar Integration</h1>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Sync events with your calendar application
        </p>
      </div>

      {/* Provider Selection */}
      <div className="card p-4">
        <label className="block text-sm font-medium mb-2">Select Calendar Provider</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {providers.map(p => (
            <button
              key={p.key}
              onClick={() => setProvider(p.key)}
              className={`p-4 rounded-lg border-2 text-sm font-medium transition-colors ${
                provider === p.key
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-600'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border-hover)]'
              }`}
            >
              <div className="text-2xl mb-1">{p.icon}</div>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Connection Status */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold">Connection Status</p>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {connected ? 'Connected and syncing' : 'Not connected'}
            </p>
          </div>
          <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400'}`} />
        </div>
      </div>

      {/* Sync Settings */}
      <div className="card p-4 space-y-3">
        <h3 className="font-semibold">Sync Settings</h3>
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" defaultChecked className="w-4 h-4" />
            <span className="text-sm">Sync new events automatically</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" defaultChecked className="w-4 h-4" />
            <span className="text-sm">Sync event updates</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" defaultChecked className="w-4 h-4" />
            <span className="text-sm">Send calendar invites to guests</span>
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        {!connected ? (
          <button
            onClick={handleConnect}
            className="btn btn-primary w-full py-3"
          >
            Connect {providers.find(p => p.key === provider)?.label}
          </button>
        ) : (
          <>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="btn btn-secondary w-full py-3"
            >
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
            <button
              onClick={handleDisconnect}
              className="btn btn-ghost w-full py-3 text-red-500"
            >
              Disconnect
            </button>
          </>
        )}
      </div>

      {/* Info Box */}
      <div className="card p-4 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
        <p className="text-sm text-blue-700 dark:text-blue-300">
          <strong>Note:</strong> Calendar integration requires OAuth setup. This feature is currently in development and will be available in a future update.
        </p>
      </div>
    </div>
  );
}
