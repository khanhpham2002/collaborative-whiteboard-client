import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { jwtDecode } from "jwt-decode";
import { PenTool } from 'lucide-react';

export default function Home() {
  const [user, setUser] = useState(null);
  const [roomIdInput, setRoomIdInput] = useState('');
  const navigate = useNavigate();

  const handleLoginSuccess = (credentialResponse) => {
    const decoded = jwtDecode(credentialResponse.credential);
    setUser({
      name: decoded.name,
      email: decoded.email,
      picture: decoded.picture
    });
    console.log("Logged in as: ", decoded.name);
  };

  const createRoom = () => {
    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    navigate(`/room/${newRoomId}`, { state: { user } });
  };

  const joinRoom = (e) => {
    e.preventDefault();
    if (roomIdInput.trim()) {
      navigate(`/room/${roomIdInput.trim().toUpperCase()}`, { state: { user } });
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', 
      justifyContent: 'center', height: '100vh', backgroundColor: '#0f172a', color: 'white'
    }}>
      <div style={{
        background: '#1e293b', padding: '40px', borderRadius: '16px', 
        boxShadow: '0 10px 25px rgba(0,0,0,0.5)', textAlign: 'center',
        width: '100%', maxWidth: '400px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
          <PenTool size={48} color="#3b82f6" />
        </div>
        <h1 style={{ marginBottom: '10px' }}>Live Whiteboard</h1>
        <p style={{ color: '#94a3b8', marginBottom: '30px' }}>
          Vẽ và cộng tác theo thời gian thực
        </p>

        {!user ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <p>Đăng nhập để tạo hoặc vào phòng riêng</p>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <GoogleLogin
                onSuccess={handleLoginSuccess}
                onError={() => console.log('Login Failed')}
                useOneTap
              />
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'center', marginBottom: '10px' }}>
              <img src={user.picture} alt="Avatar" style={{ width: '40px', borderRadius: '50%' }} />
              <span>Xin chào, <b>{user.name}</b></span>
            </div>

            <button 
              onClick={createRoom}
              style={{
                padding: '12px', background: '#3b82f6', color: 'white', 
                border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold'
              }}
            >
              Tạo phòng vẽ mới
            </button>

            <div style={{ color: '#94a3b8' }}>hoặc</div>

            <form onSubmit={joinRoom} style={{ display: 'flex', gap: '10px' }}>
              <input 
                type="text" 
                placeholder="Nhập mã phòng" 
                value={roomIdInput}
                onChange={(e) => setRoomIdInput(e.target.value)}
                style={{
                  flex: 1, padding: '10px', borderRadius: '8px', 
                  border: '1px solid #334155', background: '#0f172a', color: 'white'
                }}
              />
              <button 
                type="submit"
                style={{
                  padding: '10px 16px', background: '#10b981', color: 'white', 
                  border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold'
                }}
              >
                Vào
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
