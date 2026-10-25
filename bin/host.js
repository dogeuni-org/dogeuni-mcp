#!/usr/bin/env node
// Entry point Chrome runs (through the ~/.dogeuni/host launcher). Chrome passes
// the caller origin as an argument; it is ignored.
import { runHost } from '../src/host.js';

runHost();
