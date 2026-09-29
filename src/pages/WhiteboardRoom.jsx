import React, { useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Client } from '@stomp/stompjs';
import { 
  Pen, 
  Eraser, 
  Trash2, 
  Download, 
  Undo2,
  Square,
  Circle,
  Minus
} from 'lucide-react';

// Tạo 1 ID ngẫu nhiên cho mỗi tab trình duyệt để phân biệt ai đang vẽ
const SENDER_ID = Math.random().toString(36).substring(2, 9);

export default function WhiteboardRoom() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const user = location.state?.user;

  // Nếu chưa đăng nhập, đá về trang chủ
  useEffect(() => {
    if (!user) {
      navigate('/');
    }
  }, [user, navigate]);

  const canvasRef = useRef(null);
  const stompClientRef = useRef(null);

  const [isConnected, setIsConnected] = useState(false);
  const [tool, setTool] = useState('pen'); // 'pen' | 'eraser' | 'rect' | 'circle' | 'line'
  const [color, setColor] = useState('#0f172a');
  const [lineWidth, setLineWidth] = useState(4);
  const [isDrawing, setIsDrawing] = useState(false);

  // Tọa độ điểm trước đó khi rê chuột
  const prevCoordRef = useRef({ x: 0, y: 0 });
  // Tọa độ điểm bắt đầu khi vẽ hình khối
  const startCoordRef = useRef({ x: 0, y: 0 });
  const strokeIdRef = useRef(null);
  const allSegmentsRef = useRef([]); // Lưu trữ toàn bộ nét vẽ để hoàn tác

  // 1. Kết nối WebSocket STOMP
  useEffect(() => {
    // Xác định backend URL từ env variable hoặc mặc định cho local dev
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
        console.log('✅ WebSocket Connected to', brokerURL);
        setIsConnected(true);

        // Lắng nghe kênh vẽ của phòng này
        client.subscribe(`/topic/room/${roomId}/draw`, (message) => {
          const data = JSON.parse(message.body);
          allSegmentsRef.current.push(data);
          
          // Nếu nét vẽ đến từ người khác thì vẽ lên canvas của mình
          if (data.senderId !== SENDER_ID) {
            drawSegment(data);
          }
        });

        // Lắng nghe lệnh xóa trắng bảng
        client.subscribe(`/topic/room/${roomId}/clear`, () => {
          allSegmentsRef.current = [];
          clearCanvasLocal();
        });

        // Lắng nghe lệnh hoàn tác
        client.subscribe(`/topic/room/${roomId}/undo`, (message) => {
          const data = JSON.parse(message.body);
          if (data.strokeId) {
            // Lọc bỏ tất cả các đoạn thẳng có cùng strokeId
            allSegmentsRef.current = allSegmentsRef.current.filter(s => s.strokeId !== data.strokeId);
            redrawAllSegments();
          }
        });

        // Tải lại toàn bộ nét vẽ đã có từ server cho người mới vào
        loadExistingDrawings();
      },
      onDisconnect: () => {
        console.log('❌ WebSocket Disconnected');
        setIsConnected(false);
      },
      onStompError: (frame) => {
        console.error('Broker error:', frame.headers['message']);
      }
    });

    client.activate();
    stompClientRef.current = client;

    return () => {
      client.deactivate();
    };
  }, []);

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

  // Tải lại toàn bộ nét vẽ từ server khi người dùng mới kết nối
  const loadExistingDrawings = async () => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || `${window.location.protocol}//${window.location.hostname}:8088`;
      const response = await fetch(`${backendUrl}/api/drawings/${roomId}`);
      if (!response.ok) throw new Error('Failed to load drawings');

      const drawings = await response.json();
      console.log(`📥 Tải lại ${drawings.length} nét vẽ từ server`);
      
      allSegmentsRef.current = drawings;
      redrawAllSegments();
    } catch (err) {
      console.error('Không thể tải nét vẽ cũ:', err);
    }
  };

  // 4. Bắt sự kiện chuột & cảm ứng (Mouse & Touch)
  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (e.touches && e.touches[0]) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handleStartDrawing = (e) => {
    const coords = getCoordinates(e);
    prevCoordRef.current = coords;
    startCoordRef.current = coords;
    strokeIdRef.current = Math.random().toString(36).substring(2, 15); // Tạo ID duy nhất cho nét vẽ/hình khối
    setIsDrawing(true);
  };

  const handleDrawing = (e) => {
    if (!isDrawing) return;

    const currentCoords = getCoordinates(e);
    const currentColor = tool === 'eraser' ? '#ffffff' : color;
    const currentWidth = tool === 'eraser' ? lineWidth * 2.5 : lineWidth;

    const isShape = tool === 'rect' || tool === 'circle' || tool === 'line';

    if (isShape) {
      // Nếu vẽ hình khối, ta chỉ vẽ "nháp" (preview) lên màn hình của mình
      // Bằng cách xóa sạch canvas, vẽ lại tất cả các nét cũ, rồi vẽ hình nháp hiện tại
      redrawAllSegments();
      
      const previewSegment = {
        prevX: startCoordRef.current.x,
        prevY: startCoordRef.current.y,
        currX: currentCoords.x,
        currY: currentCoords.y,
        color: currentColor,
        lineWidth: currentWidth,
        type: tool,
      };
      drawSegment(previewSegment, true);
    } else {
      // Nếu là bút hoặc tẩy, ta vẽ liên tục và bắn dữ liệu đi ngay
      const segment = {
        prevX: prevCoordRef.current.x,
        prevY: prevCoordRef.current.y,
        currX: currentCoords.x,
        currY: currentCoords.y,
        color: currentColor,
        lineWidth: currentWidth,
        senderId: SENDER_ID,
        strokeId: strokeIdRef.current,
        type: tool,
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
    
    // Nếu vẽ hình khối, lúc nhả chuột ta mới chốt hình và gửi lên server
    if (isShape) {
      const currentCoords = prevCoordRef.current; // Tọa độ cuối cùng
      const currentColor = color;
      
      // Bỏ qua nếu click mà không kéo (khoảng cách quá nhỏ)
      const dx = currentCoords.x - startCoordRef.current.x;
      const dy = currentCoords.y - startCoordRef.current.y;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) {
         redrawAllSegments();
         return;
      }

      const segment = {
        prevX: startCoordRef.current.x,
        prevY: startCoordRef.current.y,
        currX: currentCoords.x,
        currY: currentCoords.y,
        color: currentColor,
        lineWidth: lineWidth,
        senderId: SENDER_ID,
        strokeId: strokeIdRef.current,
        type: tool,
      };

      allSegmentsRef.current.push(segment);
      redrawAllSegments(); // Vẽ lại chính thức

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
    // 1. Optimistic UI Update: Phản hồi ngay lập tức trên màn hình của mình (độ trễ 0ms)
    const mySegments = allSegmentsRef.current.filter(s => s.senderId === SENDER_ID);
    if (mySegments.length > 0) {
      // Tìm ID của nét vẽ cuối cùng mình vừa vẽ
      const lastStrokeId = mySegments[mySegments.length - 1].strokeId;
      
      // Xóa nét vẽ đó khỏi bộ nhớ tạm và vẽ lại màn hình ngay lập tức
      allSegmentsRef.current = allSegmentsRef.current.filter(s => s.strokeId !== lastStrokeId);
      redrawAllSegments();
    }

    // 2. Gửi lệnh lên server để xóa trong DB và đồng bộ với màn hình của người khác
    if (stompClientRef.current && stompClientRef.current.connected) {
      stompClientRef.current.publish({
        destination: `/app/room/${roomId}/undo`,
        body: JSON.stringify({ senderId: SENDER_ID }),
      });
    }
  };

  const handleClearBoard = () => {
    if (window.confirm('Bạn có chắc chắn muốn xóa sạch bảng vẽ của phòng này?')) {
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
    link.download = `whiteboard-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  if (!user) return null; // Chống flash màn hình khi chưa render xong useEffect

  return (
    <div className="whiteboard-container">
      {/* Góc trên bên trái: Trạng thái kết nối */}
      <div className="header-badge" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className={`status-dot ${isConnected ? '' : 'offline'}`} />
          <span className="brand-title">Phòng: {roomId}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
          <img src={user.picture} alt="" style={{ width: '16px', borderRadius: '50%' }} />
          <span>{user.name}</span>
        </div>
      </div>

      {/* Thanh công cụ vẽ */}
      <div className="floating-toolbar">
        {/* Chọn chế độ vẽ */}
        <div className="tool-group">
          <button 
            className={`tool-btn ${tool === 'pen' ? 'active' : ''}`}
            onClick={() => setTool('pen')}
            title="Bút vẽ tự do"
          >
            <Pen size={18} />
          </button>
          <button 
            className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`}
            onClick={() => setTool('eraser')}
            title="Cục tẩy"
          >
            <Eraser size={18} />
          </button>
          
          {/* Các công cụ hình khối */}
          <button 
            className={`tool-btn ${tool === 'line' ? 'active' : ''}`}
            onClick={() => setTool('line')}
            title="Kẻ đường thẳng"
          >
            <Minus size={18} />
          </button>
          <button 
            className={`tool-btn ${tool === 'rect' ? 'active' : ''}`}
            onClick={() => setTool('rect')}
            title="Vẽ hình chữ nhật"
          >
            <Square size={18} />
          </button>
          <button 
            className={`tool-btn ${tool === 'circle' ? 'active' : ''}`}
            onClick={() => setTool('circle')}
            title="Vẽ hình tròn"
          >
            <Circle size={18} />
          </button>
        </div>

        <div className="divider" />

        {/* Bảng chọn màu sắc */}
        {tool !== 'eraser' && (
          <>
            <div className="color-picker-group">
              <input 
                type="color" 
                className="color-picker-input"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                title="Chọn màu"
              />
            </div>
            <div className="divider" />
          </>
        )}

        {/* Chỉnh độ to nhỏ của nét bút */}
        <div className="slider-container">
          <input 
            type="range" 
            min="2" 
            max="40" 
            value={lineWidth} 
            onChange={(e) => setLineWidth(Number(e.target.value))}
            title={`Nét vẽ: ${lineWidth}px`}
          />
          <span>{lineWidth}px</span>
        </div>

        <div className="divider" />

        {/* Thao tác bảng */}
        <div className="tool-group">
          <button 
            className="tool-btn" 
            onClick={handleUndo}
            title="Hoàn tác (Undo)"
          >
            <Undo2 size={18} />
          </button>
          <button 
            className="tool-btn danger" 
            onClick={handleClearBoard}
            title="Xóa trắng bảng vẽ"
          >
            <Trash2 size={18} />
          </button>
          <button 
            className="tool-btn" 
            onClick={handleDownload}
            title="Tải ảnh vẽ về máy"
          >
            <Download size={18} />
          </button>
        </div>
      </div>

      {/* Màn hình Canvas chính */}
      <canvas 
        ref={canvasRef}
        onMouseDown={handleStartDrawing}
        onMouseMove={handleDrawing}
        onMouseUp={handleStopDrawing}
        onMouseLeave={handleStopDrawing}
        onTouchStart={handleStartDrawing}
        onTouchMove={handleDrawing}
        onTouchEnd={handleStopDrawing}
        onTouchCancel={handleStopDrawing}
      />
    </div>
  );
}
