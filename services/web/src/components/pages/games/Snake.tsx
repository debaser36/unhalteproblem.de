import React, { useState, useEffect, useCallback } from "react";
import { Button, Container, Form, FormText,  } from "react-bootstrap";
import "../../../styles/snake.scss";

const INITIAL_SNAKE = [{ x: 2, y: 2 }];
const INITIAL_SPEED = 120;
const DEFAULT_BOARD_SIZE = 10;

interface Position {
  x: number;
  y: number;
}

interface Direction {
  x: number;
  y: number;
}

const DIRECTIONS: Record<DirectionKey, Direction> = {
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    w: { x: 0, y: -1 },
    s: { x: 0, y: 1 },
    a: { x: -1, y: 0 },
    d: { x: 1, y: 0 },
  };

  const getRandomPosition = (snake: Position[], size: number): Position => {
    let position: Position;
    do {
      position = {
        x: Math.floor(Math.random() * size),
        y: Math.floor(Math.random() * size),
      };
    } while (snake.some(segment => segment.x === position.x && segment.y === position.y));
    
    return position;
  };



  // 0% -> 300
  // 100% -> 80
  const percentageToSpeed = (percentageToSpeed: number) =>
  {
    if(percentageToSpeed > 100) return 80;
    if(percentageToSpeed < 0) return 300;
    return (-2.2 * percentageToSpeed) + 300;
  }

  const speedToPercentage = (speed: number) => 
  {
    if(speed > 300) return 0;
    if(speed < 80) return 100;
    return ((speed - 300) / (-2.2))
  }
type DirectionKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'w' | 's' | 'a' | 'd';

const GameSnake: React.FC = () => {
  const [boardSize, setBoardSize] = useState<number>(DEFAULT_BOARD_SIZE);
  const [boardSizeInput, setBoardSizeInput] = useState<string>(DEFAULT_BOARD_SIZE.toString());
  const [snake, setSnake] = useState<Position[]>(INITIAL_SNAKE);
  const [food, setFood] = useState<Position>(() => getRandomPosition(INITIAL_SNAKE, DEFAULT_BOARD_SIZE));
  const [direction, setDirection] = useState<Direction>(DIRECTIONS.ArrowRight);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [gameOver, setGameOver] = useState<boolean>(false);
  const [score, setScore] = useState<number>(0);
  const [speed, setSpeed] = useState<number>(INITIAL_SPEED);
  const [speedPercent, setSpeedPercent] = useState<string>(speedToPercentage(INITIAL_SPEED).toString());



 

  // Prevent 180 degree turns
  const isOppositeDirection = (current: Direction, next: Direction): boolean => {
    return (
      (current.x === 1 && next.x === -1) ||
      (current.x === -1 && next.x === 1) ||
      (current.y === 1 && next.y === -1) ||
      (current.y === -1 && next.y === 1)
    );
  };

  const moveSnake = useCallback(() => {
    setSnake((prev) => {
      const newHead: Position = {
        x: prev[0].x + direction.x,
        y: prev[0].y + direction.y,
      };
      
      // Check if snake hits the border
      if (newHead.x < 0 || newHead.x >= boardSize || newHead.y < 0 || newHead.y >= boardSize) {
        setIsRunning(false);
        setGameOver(true);
        return prev;
      }
      
      // Check if snake collides with itself
      if (prev.slice(1).some(segment => segment.x === newHead.x && segment.y === newHead.y)) {
        setIsRunning(false);
        setGameOver(true);
        return prev;
      }
      
      // Check if food is eaten
      const hasEaten = newHead.x === food.x && newHead.y === food.y;
      
      const newSnake = hasEaten
        ? [newHead, ...prev] // Grow snake
        : [newHead, ...prev.slice(0, -1)];
      
      if (hasEaten) {
        setScore(s => s + 1);
        setFood(getRandomPosition(newSnake, boardSize)); // Spawn new food
      }
      
      return newSnake;
    });
  }, [direction, food, boardSize]);

  useEffect(() => {
    if (!isRunning) return;
    const gameInterval = setInterval(moveSnake, speed);
    return () => clearInterval(gameInterval);
  }, [isRunning, moveSnake, speed]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const key = event.key as DirectionKey;
    const newDirection = DIRECTIONS[key];
    if (newDirection && !isOppositeDirection(direction, newDirection)) {
      setDirection(newDirection);
    }
  }, [direction]);

  const handleButtonClick = (dir: DirectionKey): void => {
    const newDirection = DIRECTIONS[dir];
    if (!isOppositeDirection(direction, newDirection)) {
      setDirection(newDirection);
    }
  };

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    document.documentElement.style.setProperty("--board-size", boardSize.toString());
  }, [boardSize]);
  
  const resetGame = (): void => {
    setSnake(INITIAL_SNAKE);
    setFood(getRandomPosition(INITIAL_SNAKE, boardSize));
    setDirection(DIRECTIONS.ArrowRight);
    setGameOver(false);
    setScore(0);
    setIsRunning(true);
  };



  const handleSpeedChange = 
  (e: React.ChangeEvent<HTMLInputElement>): void => {
    //console.log(e.target.value);
    
    setSpeedPercent(e.target.value);
    //console.log("state Value", speedPercent);
    updateSpeed();
  };

  const updateSpeed = (): void => {
    const sP = parseInt(speedPercent);
    if(!isNaN(sP))
    {
        setSpeed(percentageToSpeed(sP));
        if(isRunning)
        {
            setIsRunning(false);
            setGameOver(true);
        }
    }
    else setSpeedPercent("100");
  }

  const handleBoardSizeChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setBoardSizeInput(e.target.value);
    updateBoardSize();
  };
  const updateBoardSize = (): void => {
    const newSize = parseInt(boardSizeInput);
    if (!isNaN(newSize) && newSize >= 5 && newSize <= 30) {
      setBoardSize(newSize);
      if (isRunning) {
        setIsRunning(false);
        setGameOver(true);
      }
    } else {
      setBoardSizeInput(boardSize.toString());
    }
  };

  return (
    <Container className="game-container">
      <h1>Snake Game</h1>
      <p>Score: {score}</p>
      
      {gameOver ? (
        <div className="game-over">
          <h2>Game Over!</h2>
          <p>Your score: {score}</p>
          <Button onClick={resetGame} className="mb-3">Restart Game</Button>
          <Form className="board-size-form mt-2">
            <Form.Group>
              <Form.Label>Board Size:</Form.Label>
              <div className="d-flex align-items-center justify-content-center">
                <Form.Control 
                  type="number" 
                  value={boardSizeInput}
                  onChange={handleBoardSizeChange}
                  onInput={handleBoardSizeChange}
                  min="5"
                  max="30"
                  style={{ width: '80px', marginRight: '10px' }}
                />
              </div>
              <FormText>Choose a size between 5 and 30</FormText>
            </Form.Group>
          </Form>

          <Form className="board-size-form mt-2">
          <Form.Label>Game Speed:</Form.Label>
          <div className="d-flex align-items-center justify-content-center">
          <Form.Range 
            value={speedPercent}
            onChange={handleSpeedChange}
            >
          </Form.Range>
          </div>

          </Form>
        </div>
      ) : !isRunning ? (
        <>
          <Button onClick={() => setIsRunning(true)} className="mb-3">Start Game</Button>
          <Form className="board-size-form mt-2">
            <Form.Group>
              <Form.Label>Board Size:</Form.Label>
              <div className="d-flex align-items-center justify-content-center">
                <Form.Control 
                  type="number" 
                  value={boardSizeInput}
                  onChange={handleBoardSizeChange}
                  min="5"
                  max="30"
                  style={{ width: '80px', marginRight: '10px' }}
                />
              </div>
              <FormText>Choose a size between 5 and 30</FormText>
            </Form.Group>
          </Form>
          <Form className="board-size-form mt-2">
          <Form.Label>Game Speed:</Form.Label>
          <div className="d-flex align-items-center justify-content-center">
          <Form.Range 
            value={speedPercent}
            onChange={handleSpeedChange}
            >
          </Form.Range>
          </div>

          </Form>
          
        </>
      ) : (
        <>
          <div className="game-board">
            {Array.from({ length: boardSize * boardSize }).map((_, index) => {
              const x = index % boardSize;
              const y = Math.floor(index / boardSize);
              
              return (
                <div
                  key={index}
                  className={`cell ${
                    snake.some((segment) => segment.x === x && segment.y === y)
                      ? "snake"
                      : ""
                  } ${food.x === x && food.y === y ? "food" : ""}`}
                />
              );
            })}
          </div>
          <div className="controls">
            <Button onClick={() => handleButtonClick("ArrowUp")}>⬆️</Button>
            <div>
              <Button onClick={() => handleButtonClick("ArrowLeft")}>⬅️</Button>
              <Button onClick={() => handleButtonClick("ArrowRight")}>➡️</Button>
            </div>
            <Button onClick={() => handleButtonClick("ArrowDown")}>⬇️</Button>
          </div>
        </>
      )}
    </Container>
  );
};

export default GameSnake;