import React, { useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Client } from '@stomp/stompjs';
import { GoogleLogin } from '@react-oauth/google';
import { jwtDecode } from "jwt-decode";
import { 
  Pen, 
  Eraser, 
  Trash2, 
  Download, 
  Undo2,
  Square,
  Circle,
  Minus,
  Lock,
  LogOut,
  X,
  Copy
} from 'lucide-react';

// Tạo 1 ID ngẫu nhiên cho mỗi tab trình duyệt để phân biệt ai đang vẽ
const SENDER_ID = Math.random().toString(36).substring(2, 9);

export default function WhiteboardRoom() {
  const { roomId = 'PUBLIC' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  
  // Khôi phục user từ location.state hoặc localStorage
  const [user, setUser] = useState(() => {
    if (location.state?.user) return location.state.user;
    const saved = localStorage.getItem('wb_user');
    return saved ? JSON.parse(saved) : null;
  });

  const activeUser = user || {
    name: 'Anonymous',
    picture: 'https://ui-avatars.com/api/?name=A&background=0f172a&color=fff'
  };

  // State quản lý Modal Phòng riêng
  const [showModal, setShowModal] = useState(false);
  const [roomInput, setRoomInput] = useState('');

  const canvasRef = useRef(null);
  const stompClientRef = useRef(null);

  const [isConnected, setIsConnected] = useState(false);
  const [tool, setTool] = useState('pen'); 
  const [color, setColor] = useState('#0f172a');
  const [lineWidth, setLineWidth] = useState(4);
  const [isDrawing, setIsDrawing] = useState(false);

  const prevCoordRef = useRef({ x: 0, y: 0 });
  const startCoordRef = useRef({ x: 0, y: 0 });
  const strokeIdRef = useRef(null);
  const allSegmentsRef = useRef([]);

  // Bắt buộc đăng nhập nếu đang ở phòng riêng
  useEffect(() => {
    if (roomId !== 'PUBLIC' && !user) {
      alert("You must be logged in to access private rooms!");
      navigate('/');
    }
  }, [roomId, user, navigate]);

  // 1. Kết nối WebSocket STOMP
  useEffect(() => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || `${window.location.protocol}//${window.location.hostname}:8088`;
    const wsProtocol = backendUrl.startsWith('https') ? 'wss:' : 'ws:';
    const backendHost = backendUrl.replace(/^https?:\/\//, '');
    const brokerURL = `${wsProtocol}//${backendHost}/ws-whiteboard`;

    const client = new Client({
      brokerURL: brokerURL,
      reconnectDelay: 3000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      onConnect: () => {
        setIsConnected(true);

        client.subscribe(`/topic/room/${roomId}/draw`, (message) => {
          const data = JSON.parse(message.body);
          allSegmentsRef.current.push(data);
          if (data.senderId !== SENDER_ID) {
            drawSegment(data);
          }
        });

        client.subscribe(`/topic/room/${roomId}/clear`, () => {
          allSegmentsRef.current = [];
          clearCanvasLocal();
        });

        client.subscribe(`/topic/room/${roomId}/undo`, (message) => {
          const data = JSON.parse(message.body);
          if (data.strokeId) {
            allSegmentsRef.current = allSegmentsRef.current.filter(s => s.strokeId !== data.strokeId);
            redrawAllSegments();
          }
        });

        loadExistingDrawings();
      },
      onDisconnect: () => {
        setIsConnected(false);
      },
    });

    client.activate();
    stompClientRef.current = client;

    return () => {
      client.deactivate();
    };
  }, [roomId]); // Re-connect if roomId changes

  // 2. Khởi tạo kích thước Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      redrawAllSegments();
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  // 3. Hàm vẽ phân loại theo công cụ
  const drawSegment = (segment, isPreview = false) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.beginPath();
    ctx.strokeStyle = segment.color;
    ctx.lineWidth = segment.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (segment.type === 'rect') {
      ctx.strokeRect(segment.prevX, segment.prevY, segment.currX - segment.prevX, segment.currY - segment.prevY);
    } else if (segment.type === 'circle') {
      const radius = Math.sqrt(Math.pow(segment.currX - segment.prevX, 2) + Math.pow(segment.currY - segment.prevY, 2));
      ctx.arc(segment.prevX, segment.prevY, radius, 0, 2 * Math.PI);
      ctx.stroke();
    } else { // pen, eraser, line
      ctx.moveTo(segment.prevX, segment.prevY);
      ctx.lineTo(segment.currX, segment.currY);
      ctx.stroke();
    }
    ctx.closePath();
  };

  const clearCanvasLocal = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const redrawAllSegments = () => {
    clearCanvasLocal();
    allSegmentsRef.current.forEach(d => {
      drawSegment(d);
    });
  };

  const loadExistingDrawings = async () => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || `${window.location.protocol}//${window.location.hostname}:8088`;
      const response = await fetch(`${backendUrl}/api/drawings/${roomId}`);
      if (!response.ok) throw new Error('Failed to load drawings');

      const drawings = await response.json();
      allSegmentsRef.current = drawings;
      redrawAllSegments();
    } catch (err) {
      console.error('Failed to load previous drawings:', err);
    }
  };

  // 4. Bắt sự kiện chuột & cảm ứng
  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (e.touches && e.touches[0]) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleStartDrawing = (e) => {
    const coords = getCoordinates(e);
    prevCoordRef.current = coords;
    startCoordRef.current = coords;
    strokeIdRef.current = Math.random().toString(36).substring(2, 15);
    setIsDrawing(true);
  };

  const handleDrawing = (e) => {
    if (!isDrawing) return;

    const currentCoords = getCoordinates(e);
    const currentColor = tool === 'eraser' ? '#ffffff' : color;
    const currentWidth = tool === 'eraser' ? lineWidth * 2.5 : lineWidth;
    const isShape = tool === 'rect' || tool === 'circle' || tool === 'line';

    if (isShape) {
      redrawAllSegments();
      const previewSegment = {
        prevX: startCoordRef.current.x, prevY: startCoordRef.current.y,
        currX: currentCoords.x, currY: currentCoords.y,
        color: currentColor, lineWidth: currentWidth, type: tool,
      };
      drawSegment(previewSegment, true);
    } else {
      const segment = {
        prevX: prevCoordRef.current.x, prevY: prevCoordRef.current.y,
        currX: currentCoords.x, currY: currentCoords.y,
        color: currentColor, lineWidth: currentWidth,
        senderId: SENDER_ID, strokeId: strokeIdRef.current, type: tool,
      };

      drawSegment(segment);
      allSegmentsRef.current.push(segment);

      if (stompClientRef.current && stompClientRef.current.connected) {
        stompClientRef.current.publish({
          destination: `/app/room/${roomId}/draw`,
          body: JSON.stringify(segment),
        });
      }
    }
    prevCoordRef.current = currentCoords;
  };

  const handleStopDrawing = (e) => {
    if (!isDrawing) return;
    setIsDrawing(false);

    const isShape = tool === 'rect' || tool === 'circle' || tool === 'line';
    
    if (isShape) {
      const currentCoords = prevCoordRef.current;
      const dx = currentCoords.x - startCoordRef.current.x;
      const dy = currentCoords.y - startCoordRef.current.y;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) {
         redrawAllSegments();
         return;
      }

      const segment = {
        prevX: startCoordRef.current.x, prevY: startCoordRef.current.y,
        currX: currentCoords.x, currY: currentCoords.y,
        color: color, lineWidth: lineWidth,
        senderId: SENDER_ID, strokeId: strokeIdRef.current, type: tool,
      };

      allSegmentsRef.current.push(segment);
      redrawAllSegments();

      if (stompClientRef.current && stompClientRef.current.connected) {
        stompClientRef.current.publish({
          destination: `/app/room/${roomId}/draw`,
          body: JSON.stringify(segment),
        });
      }
    }
  };

  // 5. Thao tác bảng
  const handleUndo = () => {
    const mySegments = allSegmentsRef.current.filter(s => s.senderId === SENDER_ID);
    if (mySegments.length > 0) {
      const lastStrokeId = mySegments[mySegments.length - 1].strokeId;
      allSegmentsRef.current = allSegmentsRef.current.filter(s => s.strokeId !== lastStrokeId);
      redrawAllSegments();
    }

    if (stompClientRef.current && stompClientRef.current.connected) {
      stompClientRef.current.publish({
        destination: `/app/room/${roomId}/undo`,
        body: JSON.stringify({ senderId: SENDER_ID }),
      });
    }
  };

  const handleClearBoard = () => {
    if (window.confirm('Are you sure you want to clear the whiteboard for this room?')) {
      allSegmentsRef.current = [];
      clearCanvasLocal();
      if (stompClientRef.current && stompClientRef.current.connected) {
        stompClientRef.current.publish({
          destination: `/app/room/${roomId}/clear`,
          body: JSON.stringify({ senderId: SENDER_ID }),
        });
      }
    }
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `whiteboard-${roomId}-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  // 6. Xử lý Đăng nhập & Modal
  const handleLoginSuccess = (credentialResponse) => {
    const decoded = jwtDecode(credentialResponse.credential);
    const loggedInUser = {
      name: decoded.name,
      email: decoded.email,
      picture: decoded.picture
    };
    setUser(loggedInUser);
    localStorage.setItem('wb_user', JSON.stringify(loggedInUser));
  };

  const createRoom = () => {
    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    setShowModal(false);
    navigate(`/room/${newRoomId}`);
  };

  const joinRoom = (e) => {
    e.preventDefault();
    if (roomInput.trim()) {
      setShowModal(false);
      navigate(`/room/${roomInput.trim().toUpperCase()}`);
    }
  };

  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    alert('Room code copied to clipboard!');
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('wb_user');
    if (roomId !== 'PUBLIC') {
      navigate('/');
    }
  };

  return (
    <div className="whiteboard-container">
      {/* Góc trên bên trái: Trạng thái */}
      <div className="header-badge" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className={`status-dot ${isConnected ? '' : 'offline'}`} />
          <span className="brand-title">
            {roomId === 'PUBLIC' ? 'Public Room' : `Room: ${roomId}`}
          </span>
          {roomId !== 'PUBLIC' && (
            <button 
              onClick={handleCopyRoomId}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              title="Copy Room Code"
            >
              <Copy size={16} />
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
          <img src={activeUser.picture} alt="" style={{ width: '16px', borderRadius: '50%' }} />
          <span>{activeUser.name}</span>
          
          {user && (
            <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', marginLeft: '4px' }} title="Logout">
              <LogOut size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Nút Tạo/Vào Phòng riêng (Góc trên bên phải) */}
      <div style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 10 }}>
        {roomId !== 'PUBLIC' ? (
           <button 
             onClick={() => navigate('/')}
             style={{ 
               padding: '10px 18px', borderRadius: '12px', background: 'rgba(30, 41, 59, 0.8)', 
               color: 'white', border: '1px solid #334155', backdropFilter: 'blur(10px)',
               cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
               boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', fontWeight: '500', transition: 'all 0.2s'
             }}
             onMouseOver={(e) => e.currentTarget.style.background = 'rgba(51, 65, 85, 0.9)'}
             onMouseOut={(e) => e.currentTarget.style.background = 'rgba(30, 41, 59, 0.8)'}
           >
             Return to Public Room
           </button>
        ) : (
           <button 
             onClick={() => setShowModal(true)}
             style={{ 
               padding: '10px 18px', borderRadius: '12px', background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)', 
               color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
               boxShadow: '0 10px 15px -3px rgba(59, 130, 246, 0.4)', fontWeight: 'bold', transition: 'transform 0.2s'
             }}
             onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
             onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
           >
             <Lock size={16} />
             Private Rooms
           </button>
        )}
      </div>

      {/* Modal Đăng nhập / Tạo phòng */}
      {showModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 100,
          display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
          <div style={{
            background: '#1e293b', padding: '30px', borderRadius: '16px', 
            width: '100%', maxWidth: '350px', color: 'white', position: 'relative'
          }}>
            <button 
              onClick={() => setShowModal(false)}
              style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>

            <h2 style={{ marginTop: 0, marginBottom: '20px', textAlign: 'center' }}>Private Rooms</h2>
            
            {!user ? (
              <div style={{ textAlign: 'center' }}>
                <p style={{ color: '#cbd5e1', marginBottom: '20px', fontSize: '14px' }}>
                  Log in to create or join a private whiteboard room.
                </p>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <GoogleLogin
                    onSuccess={handleLoginSuccess}
                    onError={() => console.log('Login Failed')}
                  />
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <button 
                  onClick={createRoom}
                  style={{
                    padding: '12px', background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', color: 'white', 
                    border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold'
                  }}
                >
                  Create New Room
                </button>
                <div style={{ textAlign: 'center', color: '#64748b', fontSize: '12px', fontWeight: 'bold' }}>OR</div>
                <form onSubmit={joinRoom} style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type="text" 
                    placeholder="Enter Room Code" 
                    value={roomInput}
                    onChange={(e) => setRoomInput(e.target.value)}
                    style={{
                      flex: 1, padding: '10px', borderRadius: '8px', 
                      border: '1px solid #334155', background: '#0f172a', color: 'white', outline: 'none'
                    }}
                  />
                  <button 
                    type="submit"
                    style={{
                      padding: '10px 16px', background: '#10b981', color: 'white', 
                      border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold'
                    }}
                  >
                    Join
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Thanh công cụ vẽ */}
      <div className="floating-toolbar">
        <div className="tool-group">
          <button className={`tool-btn ${tool === 'pen' ? 'active' : ''}`} onClick={() => setTool('pen')}><Pen size={18} /></button>
          <button className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`} onClick={() => setTool('eraser')}><Eraser size={18} /></button>
          <button className={`tool-btn ${tool === 'line' ? 'active' : ''}`} onClick={() => setTool('line')}><Minus size={18} /></button>
          <button className={`tool-btn ${tool === 'rect' ? 'active' : ''}`} onClick={() => setTool('rect')}><Square size={18} /></button>
          <button className={`tool-btn ${tool === 'circle' ? 'active' : ''}`} onClick={() => setTool('circle')}><Circle size={18} /></button>
        </div>
        <div className="divider" />
        {tool !== 'eraser' && (
          <><div className="color-picker-group">
              <input type="color" className="color-picker-input" value={color} onChange={(e) => setColor(e.target.value)}/>
            </div><div className="divider" /></>
        )}
        <div className="slider-container">
          <input type="range" min="2" max="40" value={lineWidth} onChange={(e) => setLineWidth(Number(e.target.value))}/>
          <span>{lineWidth}px</span>
        </div>
        <div className="divider" />
        <div className="tool-group">
          <button className="tool-btn" onClick={handleUndo}><Undo2 size={18} /></button>
          <button className="tool-btn danger" onClick={handleClearBoard}><Trash2 size={18} /></button>
          <button className="tool-btn" onClick={handleDownload}><Download size={18} /></button>
        </div>
      </div>

      {/* Màn hình Canvas chính */}
      <canvas 
        ref={canvasRef}
        onMouseDown={handleStartDrawing} onMouseMove={handleDrawing} onMouseUp={handleStopDrawing} onMouseLeave={handleStopDrawing}
        onTouchStart={handleStartDrawing} onTouchMove={handleDrawing} onTouchEnd={handleStopDrawing} onTouchCancel={handleStopDrawing}
      />
    </div>
  );
}
