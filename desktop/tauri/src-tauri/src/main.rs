// Empêche une console noire de s'ouvrir derrière l'application sous Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    paryaj_paw_boutik_lib::run()
}
