
--
--
--
DROP TABLE IF EXISTS `platforms`;
CREATE TABLE IF NOT EXISTS platforms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name varchar(20) NOT NULL
);

-- Dumping data for table
SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `platforms` WRITE;

INSERT INTO `platforms` VALUES
(1,'lichess.org'),
(2,'chess.com');

UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
--
--
DROP TABLE IF EXISTS `users`;
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name varchar(20) DEFAULT NULL,
  lastname varchar(20) DEFAULT NULL,
  username varchar(50) NOT NULL,
  email varchar(255) DEFAULT NULL,
  password_hash varchar(255) DEFAULT NULL,
  UNIQUE KEY `uq_username` (`username`)
);

--
--
--
DROP TABLE IF EXISTS `SignUp`;
CREATE TABLE IF NOT EXISTS SignUp (
  id INT AUTO_INCREMENT PRIMARY KEY,
  link_id varchar(64) NOT NULL,
  username varchar(50) NOT NULL,
  email varchar(255) NOT NULL,
  password_hash varchar(255) NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_link_id` (`link_id`)
);

--
--
--
DROP TABLE IF EXISTS `accounts`;
CREATE TABLE IF NOT EXISTS accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id int(11) NOT NULL,
  platform_id int(11) NOT NULL,
  accountname varchar(20) NOT NULL,
  last_scan timestamp NULL DEFAULT NULL,
  KEY `fk_user` (`user_id`),
  KEY `fk_platform` (`platform_id`),
  CONSTRAINT `fk_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_platform` FOREIGN KEY (`platform_id`) REFERENCES `platforms` (`id`)
); 

--
--
--
DROP TABLE IF EXISTS `user_games`;
CREATE TABLE IF NOT EXISTS user_games (
  `id` int(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `account_id` int(11) NOT NULL,
  `platform_id` int(11) NOT NULL,
  `game_id` varchar(255) NOT NULL,
  `book_id` int(11) DEFAULT NULL,
  `date` timestamp NOT NULL,
  `side` tinyint(1) NOT NULL DEFAULT 1,
  `termination` varchar(255) DEFAULT NULL,
  `points` tinyint(4) DEFAULT NULL,
  `result` varchar(10) DEFAULT NULL,
  `time_control` varchar(50) DEFAULT NULL,
  `white` varchar(50) DEFAULT NULL,
  `white_elo` smallint(6) DEFAULT NULL,
  `black` varchar(50) DEFAULT NULL,
  `black_elo` smallint(6) DEFAULT NULL,
  `eval_min` decimal(10,2) DEFAULT NULL,
  `eval_max` decimal(10,2) DEFAULT NULL,
  KEY `fk_account` (`account_id`),
  KEY `fk_platform` (`platform_id`),
  KEY `fk_book` (`book_id`),
  CONSTRAINT `fk_user_games_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`),
  CONSTRAINT `fk_user_games_book` FOREIGN KEY (`book_id`) REFERENCES `opening_book` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_user_games_platform` FOREIGN KEY (`platform_id`) REFERENCES `platforms` (`id`)
);

--
--
--
DROP TABLE IF EXISTS `game_moves`;
CREATE TABLE IF NOT EXISTS game_moves (
  `id` int(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `game_id` int(11) NOT NULL,
  `fen` varchar(255) NOT NULL,
  `short_notation` varchar(10) NOT NULL,
  `long_notation` varchar(15) NOT NULL,
  `side` tinyint(1) NOT NULL DEFAULT 1,
  `final_eval` decimal(10,2) DEFAULT NULL,
  `incheck` tinyint(1) DEFAULT NULL,
  `mate` tinyint(1) DEFAULT NULL,
  `loss` tinyint(1) DEFAULT NULL,
  `best_eval` varchar(20) DEFAULT NULL,
  KEY `fk_game` (`game_id`),
  CONSTRAINT `fk_game` FOREIGN KEY (`game_id`) REFERENCES `user_games` (`id`) 
);

--
--
--
DROP TABLE IF EXISTS `chess_puzzles`;
CREATE TABLE IF NOT EXISTS chess_puzzles (
  `PuzzleId` varchar(50) NOT NULL,
  `FEN` varchar(255) NOT NULL,
  `Moves` text NOT NULL,
  `NotationType` enum('UCI','SAN') NOT NULL DEFAULT 'UCI',
  `Rating` int(11) DEFAULT NULL,
  `RatingDeviation` int(11) DEFAULT NULL,
  `Popularity` smallint(6) DEFAULT NULL,
  `NbPlays` int(11) DEFAULT 0,
  `Themes` varchar(500) DEFAULT NULL,
  `SourceUrl` varchar(255) DEFAULT NULL,
  `SourceDescription` varchar(255) DEFAULT NULL,
  `OpeningTags` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`PuzzleId`),
  KEY `idx_rating` (`Rating`),
  KEY `idx_notation` (`NotationType`)
);

--
--
--
DROP TABLE IF EXISTS `challenge_book`;
CREATE TABLE IF NOT EXISTS challenge_book (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fen varchar(255) NOT NULL
);


