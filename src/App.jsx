import React, { useEffect, useRef, useState } from 'react';
import { Client } from '@stomp/stompjs';
import { 
  Pen, 
  Eraser, 
  Trash2, 
  Download, 
  Users, 
  CircleDot 
} from 'lucide-react';

const COLORS = [
  '#0f172a', // Black
  '#ef4444', // Red
  '#3b82f6', // Blue
  '#10b981', // Green
  '#f59e0b', // Amber/Yellow
  '#8b5cf6', // Purple
  '#ec4899', // Pink
];

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

  // 1. Kết nối WebSocket STOMP
  useEffect(() => {
    // Tự động xác định host WebSocket (hỗ trợ cả chạy local và chạy trên Cloud)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.port === '5173' ? '8088' : window.location.port;
    const brokerURL = `${protocol}//${host}:${port}/ws-whiteboard`;

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
          // Nếu nét vẽ đến từ người khác thì vẽ lên canvas của mình
          if (data.senderId !== SENDER_ID) {
            drawOnCanvas(data.prevX, data.prevY, data.currX, data.currY, data.color, data.lineWidth);
          }
        });

        // Lắng nghe lệnh xóa trắng bảng từ người khác
        client.subscribe('/topic/clear', () => {
          clearCanvasLocal();
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
      // Lưu lại nội dung vẽ cũ trước khi resize
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.drawImage(canvas, 0, 0);

      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(tempCanvas, 0, 0);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  // 3. Hàm vẽ đường thẳng trên Canvas
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

  // Tải lại toàn bộ nét vẽ từ server khi người dùng mới kết nối
  const loadExistingDrawings = async () => {
    try {
      const host = window.location.hostname;
      const port = window.location.port === '5173' ? '8088' : window.location.port;
      const baseUrl = `${window.location.protocol}//${host}:${port}`;

      const response = await fetch(`${baseUrl}/api/drawings`);
      if (!response.ok) throw new Error('Failed to load drawings');

      const drawings = await response.json();
      console.log(`📥 Tải lại ${drawings.length} nét vẽ từ server`);

      drawings.forEach((d) => {
        drawOnCanvas(d.prevX, d.prevY, d.currX, d.currY, d.color, d.lineWidth);
      });
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
    setIsDrawing(true);
  };

  const handleDrawing = (e) => {
    if (!isDrawing) return;

    const currentCoords = getCoordinates(e);
    const currentColor = tool === 'eraser' ? '#ffffff' : color;
    const currentWidth = tool === 'eraser' ? lineWidth * 2.5 : lineWidth;

    // Vẽ ngay lập tức lên màn hình của mình (độ trễ = 0ms)
    drawOnCanvas(
      prevCoordRef.current.x,
      prevCoordRef.current.y,
      currentCoords.x,
      currentCoords.y,
      currentColor,
      currentWidth
    );

    // Bắn tọa độ qua WebSocket cho tất cả mọi người cùng thấy
    if (stompClientRef.current && stompClientRef.current.connected) {
      stompClientRef.current.publish({
        destination: '/app/draw',
        body: JSON.stringify({
          prevX: prevCoordRef.current.x,
          prevY: prevCoordRef.current.y,
          currX: currentCoords.x,
          currY: currentCoords.y,
          color: currentColor,
          lineWidth: currentWidth,
          senderId: SENDER_ID,
        }),
      });
    }

    prevCoordRef.current = currentCoords;
  };

  const handleStopDrawing = () => {
    setIsDrawing(false);
  };

  // 5. Gửi lệnh xóa trắng bảng
  const handleClearBoard = () => {
    if (window.confirm('Bạn có chắc chắn muốn xóa sạch bảng vẽ của tất cả mọi người?')) {
      clearCanvasLocal();
      if (stompClientRef.current && stompClientRef.current.connected) {
        stompClientRef.current.publish({
          destination: '/app/clear',
          body: JSON.stringify({ senderId: SENDER_ID }),
        });
      }
    }
  };

  // 6. Tải ảnh canvas về máy tính
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
        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
          {isConnected ? '● Trực tuyến' : '○ Đang kết nối lại...'}
        </span>
      </div>

      {/* Thanh công cụ vẽ nổi ở giữa màn hình */}
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
              {COLORS.map((c) => (
                <div 
                  key={c}
                  className={`color-dot ${color === c ? 'selected' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <div className="divider" />
          </>
        )}

        {/* Chỉnh độ to nhỏ của nét bút */}
        <div className="slider-container">
          <input 
            type="range" 
            min="2" 
            max="24" 
            value={lineWidth} 
            onChange={(e) => setLineWidth(Number(e.target.value))}
            title={`Nét vẽ: ${lineWidth}px`}
          />
          <span>{lineWidth}px</span>
        </div>

        <div className="divider" />

        {/* Thao tác xóa bảng và tải ảnh */}
        <div className="tool-group">
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
            title="Tải ảnh vẽ về máy (PNG)"
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
      />

      <div className="bottom-hint">
        🎨 Mở 2 tab trình duyệt song song để thấy nét vẽ di chuyển thời gian thực!
      </div>
    </div>
  );
}
