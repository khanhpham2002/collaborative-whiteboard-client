import React, { useEffect, useRef, useState } from 'react';
import { Client } from '@stomp/stompjs';
import { 
  Pen, 
  Eraser, 
  Trash2, 
  Download, 
  Undo2
} from 'lucide-react';

// Tạo 1 ID ngẫu nhiên cho mỗi tab trình duyệt để phân biệt ai đang vẽ
const SENDER_ID = Math.random().toString(36).substring(2, 9);

export default function App() {
  const canvasRef = useRef(null);
  const stompClientRef = useRef(null);

  const [isConnected, setIsConnected] = useState(false);
  const [tool, setTool] = useState('pen'); // 'pen' | 'eraser'
  const [color, setColor] = useState('#0f172a');
  const [lineWidth, setLineWidth] = useState(4);
  const [isDrawing, setIsDrawing] = useState(false);

  // Tọa độ điểm trước đó khi rê chuột
  const prevCoordRef = useRef({ x: 0, y: 0 });
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

        // Lắng nghe kênh vẽ từ những người khác
        client.subscribe('/topic/draw', (message) => {
          const data = JSON.parse(message.body);
          allSegmentsRef.current.push(data);
          
          // Nếu nét vẽ đến từ người khác thì vẽ lên canvas của mình
          if (data.senderId !== SENDER_ID) {
            drawOnCanvas(data.prevX, data.prevY, data.currX, data.currY, data.color, data.lineWidth);
          }
        });

        // Lắng nghe lệnh xóa trắng bảng
        client.subscribe('/topic/clear', () => {
          allSegmentsRef.current = [];
          clearCanvasLocal();
        });

        // Lắng nghe lệnh hoàn tác
        client.subscribe('/topic/undo', (message) => {
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

  // 3. Hàm vẽ
  const drawOnCanvas = (x1, y1, x2, y2, strokeColor, strokeWidth) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
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
      drawOnCanvas(d.prevX, d.prevY, d.currX, d.currY, d.color, d.lineWidth);
    });
  };

  // Tải lại toàn bộ nét vẽ từ server khi người dùng mới kết nối
  const loadExistingDrawings = async () => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || `${window.location.protocol}//${window.location.hostname}:8088`;
      const response = await fetch(`${backendUrl}/api/drawings`);
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
    strokeIdRef.current = Math.random().toString(36).substring(2, 15); // Tạo ID duy nhất cho nét vẽ này
    setIsDrawing(true);
  };

  const handleDrawing = (e) => {
    if (!isDrawing) return;

    const currentCoords = getCoordinates(e);
    const currentColor = tool === 'eraser' ? '#ffffff' : color;
    const currentWidth = tool === 'eraser' ? lineWidth * 2.5 : lineWidth;

    const segment = {
      prevX: prevCoordRef.current.x,
      prevY: prevCoordRef.current.y,
      currX: currentCoords.x,
      currY: currentCoords.y,
      color: currentColor,
      lineWidth: currentWidth,
      senderId: SENDER_ID,
      strokeId: strokeIdRef.current,
    };

    // Vẽ ngay lập tức lên màn hình của mình
    drawOnCanvas(
      segment.prevX,
      segment.prevY,
      segment.currX,
      segment.currY,
      segment.color,
      segment.lineWidth
    );

    // Lưu vào bộ nhớ local
    allSegmentsRef.current.push(segment);

    // Bắn tọa độ qua WebSocket
    if (stompClientRef.current && stompClientRef.current.connected) {
      stompClientRef.current.publish({
        destination: '/app/draw',
        body: JSON.stringify(segment),
      });
    }

    prevCoordRef.current = currentCoords;
  };

  const handleStopDrawing = () => {
    setIsDrawing(false);
  };

  // 5. Thao tác bảng
  const handleUndo = () => {
    if (stompClientRef.current && stompClientRef.current.connected) {
      stompClientRef.current.publish({
        destination: '/app/undo',
        body: JSON.stringify({ senderId: SENDER_ID }),
      });
    }
  };

  const handleClearBoard = () => {
    if (window.confirm('Bạn có chắc chắn muốn xóa sạch bảng vẽ của tất cả mọi người?')) {
      allSegmentsRef.current = [];
      clearCanvasLocal();
      if (stompClientRef.current && stompClientRef.current.connected) {
        stompClientRef.current.publish({
          destination: '/app/clear',
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

  return (
    <div className="whiteboard-container">
      {/* Góc trên bên trái: Trạng thái kết nối */}
      <div className="header-badge">
        <div className={`status-dot ${isConnected ? '' : 'offline'}`} />
        <span className="brand-title">Live Whiteboard</span>
        <span className="status-text">
          {isConnected ? '● Trực tuyến' : '○ Đang kết nối...'}
        </span>
      </div>

      {/* Thanh công cụ vẽ */}
      <div className="floating-toolbar">
        {/* Chọn chế độ: Bút hoặc Tẩy */}
        <div className="tool-group">
          <button 
            className={`tool-btn ${tool === 'pen' ? 'active' : ''}`}
            onClick={() => setTool('pen')}
            title="Bút vẽ"
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
        </div>

        <div className="divider" />

        {/* Bảng chọn màu sắc */}
        {tool === 'pen' && (
          <>
            <div className="color-picker-group">
              <input 
                type="color" 
                className="color-picker-input"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                title="Chọn màu tự do"
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
