/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19-11.8.6-MariaDB, for debian-linux-gnu (aarch64)
--
-- Host: localhost    Database: Magnus
-- ------------------------------------------------------
-- Server version	11.8.6-MariaDB-0+deb13u1 from Debian

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*M!100616 SET @OLD_NOTE_VERBOSITY=@@NOTE_VERBOSITY, NOTE_VERBOSITY=0 */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(20) NOT NULL,
  `lastname` varchar(20) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `players`
--

DROP TABLE IF EXISTS `players`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `players` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `platform_id` int(11) NOT NULL,
  `accountname` varchar(20) NOT NULL,
  `last_scan` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_user` (`user_id`),
  KEY `fk_platform` (`platform_id`),
  CONSTRAINT `fk_platform` FOREIGN KEY (`platform_id`) REFERENCES `platforms` (`id`),
  CONSTRAINT `fk_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `player_games`
--

DROP TABLE IF EXISTS `player_games`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `player_games` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `player_id` int(11) NOT NULL,
  `platform_id` int(11) NOT NULL,
  `game_id` varchar(255) NOT NULL,
  `book_id` int(11) DEFAULT NULL,
  `date` timestamp NOT NULL,
  `side` tinyint(1) NOT NULL DEFAULT 1,
  `white` varchar(20) DEFAULT NULL,
  `black` varchar(20) DEFAULT NULL,
  `white_elo` smallint(6) DEFAULT NULL,
  `black_elo` smallint(6) DEFAULT NULL,
  `termination` varchar(255) DEFAULT NULL,
  `points` tinyint(4) DEFAULT NULL,
  `result` varchar(10) DEFAULT NULL,
  `time_control` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_player` (`player_id`),
  KEY `fk_platform` (`platform_id`),
  KEY `fk_book` (`book_id`),
  CONSTRAINT `fk_player_games_book` FOREIGN KEY (`book_id`) REFERENCES `opening_book` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_player_games_platform` FOREIGN KEY (`platform_id`) REFERENCES `platforms` (`id`),
  CONSTRAINT `fk_player_games_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `game_moves`
--

DROP TABLE IF EXISTS `game_moves`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_moves` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `game_id` int(11) NOT NULL,
  `fen` varchar(255) NOT NULL,
  `short_notation` varchar(10) NOT NULL,
  `long_notation` varchar(15) NOT NULL,
  `side` tinyint(1) NOT NULL DEFAULT 1,
  `eval_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_game` (`game_id`),
  KEY `eval_id` (`eval_id`),
  CONSTRAINT `fk_eval` FOREIGN KEY (`eval_id`) REFERENCES `evaluation` (`id`),
  CONSTRAINT `fk_game` FOREIGN KEY (`game_id`) REFERENCES `player_games` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `evaluation`
--

DROP TABLE IF EXISTS `evaluation`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `evaluation` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `fen` varchar(100) NOT NULL,
  `material_eval` decimal(10,2) DEFAULT NULL,
  `positional_eval` decimal(10,2) DEFAULT NULL,
  `final_eval` decimal(10,2) DEFAULT NULL,
  `is_incheck` tinyint(1) DEFAULT 0,
  `mate_in` tinyint(4) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_fen` (`fen`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;

-- Dump completed on 2026-04-16  9:40:28
