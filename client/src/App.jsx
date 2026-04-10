import { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './components/MainLayout';
import Login from './pages/Login';
import Home from './pages/Home';
import SearchChild from './pages/SearchChild';
import RegisterNewChild from './pages/RegisterNewChild';
import ChildProfile from './pages/ChildProfile';
import AddVisit from './pages/AddVisit';
import Graphs from './pages/Graphs';
import Schedule from './pages/Schedule';
import ScheduleDay from './pages/ScheduleDay';
import AppointmentPage from './pages/AppointmentPage';
import { performSync, getOutboxOps } from './db/indexedDB';
import './App.css';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncToast, setSyncToast] = useState(null); // { type: 'success' | 'error', message: string }
  const [isSyncing, setIsSyncing] = useState(false);
  const syncInProgress = useRef(false);
  const lastSyncTime = useRef(0);

  // Perform auto-sync
  const doAutoSync = async (trigger) => {
    // Guards: no token, already syncing, or too soon (10s cooldown)
    if (!token) return;
    if (syncInProgress.current) return;
    if (Date.now() - lastSyncTime.current < 10000) return;

    // Check if there are pending operations
    const pendingOps = await getOutboxOps();
    
    // Skip sync if no pending ops (unless it's app launch - always sync on launch)
    if (pendingOps.length === 0 && trigger !== 'launch') return;

    syncInProgress.current = true;
    setIsSyncing(true);
    lastSyncTime.current = Date.now();

    try {
      const result = await performSync(token);
      
      if (result.success) {
        // Only show toast if something was synced
        if (pendingOps.length > 0) {
          setSyncToast({
            type: 'success',
            message: `Synced ${pendingOps.length} change${pendingOps.length > 1 ? 's' : ''}`
          });
        } else if (result.deletedCount > 0) {
          setSyncToast({
            type: 'success',
            message: `Sync complete. ${result.deletedCount} removed.`
          });
        }
      } else {
        setSyncToast({
          type: 'error',
          message: 'Sync failed. Try again later.'
        });
      }
    } catch (error) {
      console.error('Auto-sync error:', error);
      setSyncToast({
        type: 'error',
        message: 'Sync failed. Try again later.'
      });
    } finally {
      syncInProgress.current = false;
      setIsSyncing(false);
    }
  };

  // 1. Handle online/offline events - sync when coming back online
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      doAutoSync('online');
    };
    
    const handleOffline = () => {
      setIsOnline(false);
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [token]); // Re-attach when token changes

  // 2. Auto-sync on app launch (after login)
  useEffect(() => {
    if (token && navigator.onLine) {
      // Delay to let app initialize
      const timer = setTimeout(() => {
        doAutoSync('launch');
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [token]);

  // 3. Auto-hide toast after 3 seconds
  useEffect(() => {
    if (syncToast) {
      const timer = setTimeout(() => {
        setSyncToast(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [syncToast]);

  return (
    <BrowserRouter>
      <div className="app">
        {/* Offline Banner */}
        {!isOnline && (
          <div className="offline-banner">
            Offline Mode - Changes will sync when online
          </div>
        )}
        
        {/* Sync Toast */}
        {syncToast && (
          <div 
            className={`sync-toast ${syncToast.type}`}
            onClick={() => setSyncToast(null)}
          >
            {syncToast.type === 'success' ? '✓' : '⚠'} {syncToast.message}
          </div>
        )}
        
        {/* Syncing Indicator */}
        {isSyncing && (
          <div className="syncing-indicator">
            Syncing...
          </div>
        )}

        <Routes>
          <Route
            path="/login"
            element={<Login setToken={setToken} />}
          />
          <Route
            element={token ? <MainLayout /> : <Navigate to="/login" />}
          >
            <Route
              path="/"
              element={<Home setToken={setToken} />}
            />
            <Route
              path="/children"
              element={<SearchChild token={token} />}
            />
            <Route
              path="/children/register"
              element={<RegisterNewChild token={token} />}
            />
            <Route
              path="/children/:childId"
              element={<ChildProfile token={token} />}
            />
            <Route
              path="/children/:childId/visit-entry/:visitId"
              element={<AddVisit token={token} />}
            />
            <Route
              path="/children/:childId/visit-entry"
              element={<AddVisit token={token} />}
            />
            <Route
              path="/children/:childId/appointment"
              element={<AppointmentPage token={token} />}
            />
            <Route
              path="/reports"
              element={<Graphs />}
            />
            <Route
              path="/schedule"
              element={<Schedule token={token} />}
            />
            <Route
              path="/schedule/:date"
              element={<ScheduleDay token={token} />}
            />
          </Route>
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
