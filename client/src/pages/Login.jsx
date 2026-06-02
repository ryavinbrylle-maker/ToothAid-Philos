import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Login.css';
import { API_BASE_URL, getApiPath } from '../config';

const Login = ({ setToken }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const apiPath = getApiPath('/auth/login');
      const fullUrl = `${API_BASE_URL}${apiPath}`;
      console.log('Login request URL:', fullUrl);
      
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        let errorMessage = '';
        if (contentType && contentType.includes('application/json')) {
          const errBody = await response.json();
          errorMessage = errBody.error || response.statusText;
        } else {
          errorMessage = await response.text() || response.statusText;
        }
        console.error('Login error response:', response.status, errorMessage);
        if (response.status === 401 || (errorMessage && errorMessage.toLowerCase().includes('invalid credentials'))) {
          setError('Incorrect username or password.');
          setLoading(false);
          return;
        }
        throw new Error(errorMessage || `Server error: ${response.status}`);
      }

      let data;
      const contentType = response.headers.get('content-type');
      const text = await response.text();

      if (contentType && contentType.includes('application/json') && text) {
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error('Server returned invalid JSON. Check that the backend URL is correct (VITE_API_URL).');
        }
      } else {
        console.error('Non-JSON response:', contentType, text?.slice(0, 200));
        if (!contentType && !text) {
          throw new Error('Server returned an empty response. The app may be calling the wrong URL — ensure the backend is deployed and VITE_API_URL is set when building the frontend.');
        }
        throw new Error(`Server error: ${response.status}. Expected JSON but got ${contentType || 'empty response'}. Check backend URL and CORS.`);
      }

      if (!data?.token) {
        throw new Error('Server did not return a token. Check backend and try again.');
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('username', data.username);
      setToken(data.token);
      navigate('/');
    } catch (err) {
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        setError('Cannot connect to server. Make sure the backend is accessible.');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Tooth icon SVG
  const ToothIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2C9.5 2 7 3 6 5C5 7 5 9 5.5 11C6 13 6.5 15 7 17C7.5 19 8 21 9 22C9.5 22.5 10.5 22.5 11 21C11.5 19.5 12 18 12 18C12 18 12.5 19.5 13 21C13.5 22.5 14.5 22.5 15 22C16 21 16.5 19 17 17C17.5 15 18 13 18.5 11C19 9 19 7 18 5C17 3 14.5 2 12 2Z" />
    </svg>
  );

  return (
    <div className="login-container">
      <div className="login-content">
        {/* Brand Section */}
        <div className="login-brand">
          <div className="login-icon">
            <ToothIcon />
          </div>
          <h1>ToothAid</h1>
          <p className="subtitle">Dental Data & Impact Monitoring</p>
        </div>

        {/* Form Section */}
        <div className="login-form">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                required
              />
            </div>
            
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
              />
            </div>

            {error && <div className="alert alert-danger">{error}</div>}

            <button 
              type="submit" 
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

      </div>
    </div>
  );
};

export default Login;
